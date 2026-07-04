import { z } from "zod";

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;

// Response shape every list endpoint uses, even while every dataset is
// small enough that `hasMore` is usually false — adding real pagination
// later becomes a query change, not a breaking response-shape change for
// every existing frontend consumer.
export function paginated<T>(items: T[], total: number, pagination: Pagination) {
  return {
    items,
    total,
    hasMore: pagination.offset + items.length < total,
  };
}
