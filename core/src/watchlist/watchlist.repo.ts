import { eq, and, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getUnixTime } from "date-fns";
import type { Db } from "../utils/postgres.repo.js";
import { listsSchema, listItemsSchema } from "./watchlist.schema.js";

export interface WatchlistRepo {
  getListsForUser(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      items: Array<{ ticker: string }>;
    }>
  >;
  getAllTickersForUser(userId: string): Promise<string[]>;
  createList(
    userId: string,
    id: string,
    name: string,
    createdAtSec: number
  ): Promise<{ id: string; name: string; items: Array<{ ticker: string }> }>;
  renameList(
    userId: string,
    listId: string,
    name: string
  ): Promise<{ id: string; name: string } | null>;
  deleteList(userId: string, listId: string): Promise<void>;
  addListItem(listId: string, ticker: string): Promise<void>;
  removeListItem(listId: string, ticker: string): Promise<void>;
  getListOwner(listId: string): Promise<string | null>;
  createDefaultListsForUser(userId: string): Promise<void>;
  getUserIdsWatchingTicker(ticker: string): Promise<string[]>;
}

export function makeWatchlistRepo(db: Db): WatchlistRepo {
  return {
    async getListsForUser(userId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lists = await (db as any).query.listsSchema.findMany({
        where: eq(listsSchema.userId, userId),
        with: { items: true },
        orderBy: listsSchema.createdAtSec,
      });
      return lists.map(
        (l: {
          id: string;
          name: string;
          items: Array<{ ticker: string }>;
        }) => ({
          id: l.id,
          name: l.name,
          items: l.items.map((i) => ({ ticker: i.ticker })),
        })
      );
    },

    async getAllTickersForUser(userId) {
      const lists = await db
        .select({ id: listsSchema.id })
        .from(listsSchema)
        .where(eq(listsSchema.userId, userId));
      if (lists.length === 0) return [];
      const items = await db
        .select({ ticker: listItemsSchema.ticker })
        .from(listItemsSchema)
        .where(
          inArray(
            listItemsSchema.listId,
            (lists as Array<{ id: string }>).map((l) => l.id)
          )
        );
      return [
        ...new Set((items as Array<{ ticker: string }>).map((i) => i.ticker)),
      ];
    },

    async createList(userId, id, name, createdAtSec) {
      await db.insert(listsSchema).values({ id, userId, name, createdAtSec });
      return { id, name, items: [] };
    },

    async renameList(userId, listId, name) {
      const result = await db
        .update(listsSchema)
        .set({ name })
        .where(and(eq(listsSchema.id, listId), eq(listsSchema.userId, userId)))
        .returning();
      const row = result[0] as { id: string; name: string } | undefined;
      return row ?? null;
    },

    async deleteList(userId, listId) {
      await db
        .delete(listsSchema)
        .where(and(eq(listsSchema.id, listId), eq(listsSchema.userId, userId)));
    },

    async addListItem(listId, ticker) {
      await db
        .insert(listItemsSchema)
        .values({ listId, ticker })
        .onConflictDoNothing();
    },

    async removeListItem(listId, ticker) {
      await db
        .delete(listItemsSchema)
        .where(
          and(
            eq(listItemsSchema.listId, listId),
            eq(listItemsSchema.ticker, ticker)
          )
        );
    },

    async getListOwner(listId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (db as any).query.listsSchema.findFirst({
        where: eq(listsSchema.id, listId),
      });
      return (row as { userId: string } | undefined)?.userId ?? null;
    },

    async createDefaultListsForUser(userId) {
      const now = getUnixTime(new Date());
      await db.insert(listsSchema).values([
        { id: uuidv4(), userId, name: "Watchlist", createdAtSec: now },
        { id: uuidv4(), userId, name: "Portfolio", createdAtSec: now + 1 },
      ]);
    },

    async getUserIdsWatchingTicker(ticker) {
      const rows = await db
        .selectDistinct({ userId: listsSchema.userId })
        .from(listItemsSchema)
        .innerJoin(listsSchema, eq(listItemsSchema.listId, listsSchema.id))
        .where(eq(listItemsSchema.ticker, ticker));
      return (rows as Array<{ userId: string }>).map((r) => r.userId);
    },
  };
}
