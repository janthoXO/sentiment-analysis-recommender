import type { SourceUpdateEvent } from "../utils/events.js";
import type { WatchlistRepo } from "../watchlist/watchlist.repo.js";
import type { SourceScoreRepo } from "../sentiment/source-score.repo.js";
import type { UserTickerAccessRepo } from "../stocks/user-ticker-access.repo.js";
import type { Env } from "../env.js";

export interface NotificationService {
  attach(userId: string, write: (line: string) => void): () => void;
  onSourceUpdate(evt: SourceUpdateEvent): void;
}

export function makeNotificationService({
  watchlistRepo,
  sourceScoreRepo,
  userTickerAccessRepo,
  env,
}: {
  watchlistRepo: WatchlistRepo;
  sourceScoreRepo: SourceScoreRepo;
  userTickerAccessRepo: UserTickerAccessRepo;
  env: Env;
}): NotificationService {
  // per-user: connection ref count + per-ticker cooldown for this session
  const connections = new Map<
    string,
    { count: number; cooldown: Set<string> }
  >();
  // per-user: set of write sinks (one per open tab/connection)
  const sinks = new Map<string, Set<(line: string) => void>>();
  // per-ticker: active debounce timer
  const debounces = new Map<string, ReturnType<typeof setTimeout>>();

  async function fireDebounce(ticker: string): Promise<void> {
    debounces.delete(ticker);

    const watchingUserIds =
      await watchlistRepo.getUserIdsWatchingTicker(ticker);

    await Promise.all(
      watchingUserIds.map(async (userId) => {
        const conn = connections.get(userId);
        if (!conn) return; // no active connection
        if (conn.cooldown.has(ticker)) return; // already notified this session

        const lastAccessedSec = await userTickerAccessRepo.getLastAccessedSec(
          userId,
          ticker
        );
        if (lastAccessedSec == null) return; // no baseline — skip

        const [before, latest] = await Promise.all([
          sourceScoreRepo.listLatestSourceScoresBefore(
            ticker,
            lastAccessedSec,
            env.NOTIFICATION_TOP_N
          ),
          sourceScoreRepo.listLatestSourceScoresForTicker(
            ticker,
            env.NOTIFICATION_TOP_N
          ),
        ]);

        const userSinks = sinks.get(userId);
        if (!userSinks || userSinks.size === 0) return;

        const line = JSON.stringify({ ticker, before, latest }) + "\n";
        for (const write of userSinks) {
          try {
            write(line);
          } catch {
            // sink may have closed between check and write — ignore
          }
        }

        conn.cooldown.add(ticker);
      })
    );
  }

  return {
    attach(userId, write) {
      let conn = connections.get(userId);
      if (!conn) {
        conn = { count: 0, cooldown: new Set() };
        connections.set(userId, conn);
      }
      conn.count++;

      let userSinks = sinks.get(userId);
      if (!userSinks) {
        userSinks = new Set();
        sinks.set(userId, userSinks);
      }
      userSinks.add(write);

      return () => {
        sinks.get(userId)?.delete(write);

        const c = connections.get(userId);
        if (!c) return;
        c.count--;
        if (c.count <= 0) {
          connections.delete(userId);
          sinks.delete(userId);
        }
      };
    },

    onSourceUpdate({ ticker }) {
      if (debounces.has(ticker)) return;
      const timer = setTimeout(
        () => void fireDebounce(ticker),
        env.NOTIFICATION_DEBOUNCE_SEC * 1000
      );
      debounces.set(ticker, timer);
    },
  };
}
