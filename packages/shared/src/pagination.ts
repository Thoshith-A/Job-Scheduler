import { z } from "zod";

/**
 * Shared pagination / filtering / sorting contract used by every list endpoint.
 * Offset-based by default (simple, jumpable pages) with a hard cap so a client
 * can never ask for an unbounded scan.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function makePage<T>(
  items: T[],
  total: number,
  { limit, offset }: { limit: number; offset: number },
): Page<T> {
  return { items, total, limit, offset, hasMore: offset + items.length < total };
}
