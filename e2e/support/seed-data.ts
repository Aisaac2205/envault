import { createHash } from 'node:crypto';

/**
 * The data every seeded source database holds, and the fingerprint that tells a
 * restored copy from the original. Both engines get the same rows, so a
 * fingerprint read before a backup can be compared with one read after the
 * restore.
 *
 * The rows are chosen to be awkward for a dump: NULLs in every nullable column,
 * non-ASCII text (accents, CJK, an emoji), quotes and backslashes, a decimal,
 * and a foreign key from the second table to the first.
 */

/** Tables of a seeded database, parents before children. */
export const SEED_TABLES = ['e2e_items', 'e2e_tags'] as const;

export const ITEM_COUNT = 3000;

/** Every tenth item has one tag. */
const TAG_EVERY = 10;

export type Cell = string | number | null;
export type SeedRow = Cell[];

/** `id, label, amount, note`; the decimal is a string so it never loses digits. */
export function itemRows(): SeedRow[] {
  return Array.from({ length: ITEM_COUNT }, (_, index) => {
    const id = index + 1;
    const label = id % 7 === 0 ? null : `ítem ${id} · ñandú ✓ 日本語`;
    const amount = id % 11 === 0 ? null : (((id * 37) % 100_000) / 100).toFixed(2);
    const note =
      id % 5 === 0
        ? null
        : id % 3 === 0
          ? `O'Reilly said "hi" and left a back\\slash ${id} 🙂`
          : `plain note ${id}`;
    return [id, label, amount, note];
  });
}

/** `id, item_id, tag`. */
export function tagRows(): SeedRow[] {
  return itemRows()
    .filter(([id]) => (id as number) % TAG_EVERY === 0)
    .map(([id], index) => [index + 1, id, `tag-${id}-ü`]);
}

/** How many rows each table of a freshly seeded database holds. */
export const SEEDED_ROW_COUNTS: Record<(typeof SEED_TABLES)[number], number> = {
  e2e_items: ITEM_COUNT,
  e2e_tags: ITEM_COUNT / TAG_EVERY,
};

export interface Fingerprint {
  /** Tables, constraints and indexes as `kind:name`, sorted. Empty for an empty database. */
  structure: string[];
  /** Row count of each seeded table that exists. */
  rows: Record<string, number>;
  /** SHA-256 over every row of every table that exists, in primary key order. */
  digest: string;
}

/**
 * Builds a fingerprint from what a database returned. `tables` maps a table
 * name to its rows in primary key order; drivers disagree on types (a decimal
 * is a string, an integer a number), so every cell is compared as text.
 */
export function fingerprint(structure: string[], tables: Record<string, Cell[][]>): Fingerprint {
  const present = SEED_TABLES.filter((table) => table in tables);
  const canonical = present.map((table) => [
    table,
    tables[table].map((row) => row.map((cell) => (cell === null ? null : String(cell)))),
  ]);

  return {
    structure: [...structure].sort(),
    rows: Object.fromEntries(present.map((table) => [table, tables[table].length])),
    digest: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
  };
}

/** What a database with no tables looks like. */
export const EMPTY_DATABASE: Fingerprint = fingerprint([], {});
