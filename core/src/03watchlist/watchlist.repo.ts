import { eq, and, inArray } from "drizzle-orm";
import { db } from "../postgres.repo.js";
import { listsSchema, listItemsSchema } from "./watchlist.schema.js";

export async function getListsForUser(userId: string) {
  const lists = await db.query.listsSchema.findMany({
    where: eq(listsSchema.userId, userId),
    with: { items: true },
    orderBy: listsSchema.createdAtSec,
  });
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    items: l.items.map((i) => ({ ticker: i.ticker })),
  }));
}

export async function getAllTickersForUser(userId: string): Promise<string[]> {
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
        lists.map((l) => l.id)
      )
    );
  return [...new Set(items.map((i) => i.ticker))];
}

export async function createList(
  userId: string,
  id: string,
  name: string,
  createdAtSec: number
) {
  await db.insert(listsSchema).values({ id, userId, name, createdAtSec });
  return { id, name, items: [] };
}

export async function renameList(userId: string, listId: string, name: string) {
  const result = await db
    .update(listsSchema)
    .set({ name })
    .where(and(eq(listsSchema.id, listId), eq(listsSchema.userId, userId)))
    .returning();
  return result[0] ?? null;
}

export async function deleteList(userId: string, listId: string) {
  await db
    .delete(listsSchema)
    .where(and(eq(listsSchema.id, listId), eq(listsSchema.userId, userId)));
}

export async function addListItem(listId: string, ticker: string) {
  await db
    .insert(listItemsSchema)
    .values({ listId, ticker })
    .onConflictDoNothing();
}

export async function removeListItem(listId: string, ticker: string) {
  await db
    .delete(listItemsSchema)
    .where(
      and(
        eq(listItemsSchema.listId, listId),
        eq(listItemsSchema.ticker, ticker)
      )
    );
}

export async function getListOwner(listId: string): Promise<string | null> {
  const row = await db.query.listsSchema.findFirst({
    where: eq(listsSchema.id, listId),
  });
  return row?.userId ?? null;
}
