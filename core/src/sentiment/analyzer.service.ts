import type {
  SourceResultRoot,
  SourceRoot,
  StockRoot,
} from "../generated/in/index.js";
import type { SourceScoreRepo } from "./source-score.repo.js";
import type { MqClient } from "../utils/mq.repo.js";
import { sentimentEmitter } from "../utils/events.js";

type Subscriber = {
  resolve: (result: SourceResultRoot) => void;
  reject: (error: Error) => void;
};

export interface AnalyzerService {
  requestSentiment(
    stock: StockRoot,
    sources: SourceRoot[],
    priority: number
  ): AsyncGenerator<SourceResultRoot>;
  receiveResult(result: {
    ticker: string;
    jobId: string;
    source: SourceResultRoot;
  }): Promise<void>;
}

export function makeAnalyzerService({
  sourceScoreRepo,
  mq,
}: {
  sourceScoreRepo: SourceScoreRepo;
  mq: { publishAnalysisTask: MqClient["publishAnalysisTask"] };
}): AnalyzerService {
  const pendingByKey = new Map<string, Subscriber[]>();

  function articleKey(ticker: string, url: string): string {
    return `${ticker}:${url}`;
  }

  async function* yieldAsResolved<T>(
    promises: Promise<T>[]
  ): AsyncGenerator<T> {
    const remaining = new Map<number, Promise<{ idx: number; value: T }>>(
      promises.map((p, i) => [i, p.then((value) => ({ idx: i, value }))])
    );
    while (remaining.size > 0) {
      const { idx, value } = await Promise.race(remaining.values());
      remaining.delete(idx);
      yield value;
    }
  }

  return {
    async *requestSentiment(stock, sources, priority) {
      if (sources.length === 0) return;

      const ticker = stock.ticker;
      const urls = sources.map((s) => s.url);

      const cached = await sourceScoreRepo.listSourceScoresByUrls(ticker, urls);
      const cachedUrls = new Set(cached.map((r) => r.url));
      const uncachedSources = sources.filter((s) => !cachedUrls.has(s.url));

      for (const r of cached) {
        yield r;
      }

      if (uncachedSources.length === 0) return;

      const toPublishUrls = uncachedSources
        .map((s) => s.url)
        .filter((u) => !pendingByKey.has(articleKey(ticker, u)));

      const pending: Promise<SourceResultRoot>[] = uncachedSources.map((s) => {
        return new Promise<SourceResultRoot>((resolve, reject) => {
          const key = articleKey(ticker, s.url);
          const subs = pendingByKey.get(key) ?? [];
          subs.push({ resolve, reject });
          pendingByKey.set(key, subs);
        });
      });

      if (toPublishUrls.length > 0) {
        const jobId = `${ticker}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const dbSources = await sourceScoreRepo.listSourcesByUrls(
          ticker,
          toPublishUrls
        );
        const dbByUrl = new Map(dbSources.map((s) => [s.url, s]));
        const toPublish: SourceRoot[] = toPublishUrls.map(
          (u) => dbByUrl.get(u) ?? sources.find((s) => s.url === u)!
        );
        mq.publishAnalysisTask(stock, jobId, toPublish, priority);
      }

      yield* yieldAsResolved(pending);
    },

    async receiveResult({ ticker, source }) {
      await sourceScoreRepo.upsertSourceScore(ticker, source);

      const key = articleKey(ticker, source.url);
      const subs = pendingByKey.get(key);
      if (subs) {
        pendingByKey.delete(key);
        for (const { resolve } of subs) {
          resolve(source);
        }
      }

      sentimentEmitter.emit("source-update", { ticker, source });
    },
  };
}
