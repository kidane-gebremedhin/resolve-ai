// Reusable building blocks for list endpoints: page/pageSize parsing, live text
// search, UTC date-range filtering, and a paginated find that returns a uniform
// `{ items, total, page, pageSize, totalPages }` envelope. Each endpoint picks
// the searchable fields, the date field, and any extra filters it needs.
import type { FilterQuery, SortOrder } from "mongoose";

// Structural subset of a Mongoose model — avoids the invariance clash between
// `Model<T>` and concrete models' `statics` when used as a generic parameter.
type QueryableModel = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  find: (filter: FilterQuery<any>) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  countDocuments: (filter: FilterQuery<any>) => Promise<number>;
};

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 200;

export type ListParams = {
  page: number; // 1-based
  pageSize: number;
  q?: string;
  from?: Date; // UTC, inclusive
  to?: Date; // UTC, inclusive (extended to end-of-day for date-only values)
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// Parse an ISO / `yyyy-mm-dd` string as a Date. Date-only strings are parsed as
// UTC midnight by the JS engine, which is exactly what we want for UTC ranges.
function parseDate(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseListParams(
  query: Record<string, unknown>,
  opts?: { defaultPageSize?: number },
): ListParams {
  return {
    page: clampInt(query.page, 1, 10_000_000, 1),
    pageSize: clampInt(query.pageSize, 1, MAX_PAGE_SIZE, opts?.defaultPageSize ?? DEFAULT_PAGE_SIZE),
    q: typeof query.q === "string" && query.q.trim() ? query.q.trim() : undefined,
    from: parseDate(query.from),
    to: parseDate(query.to),
  };
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Case-insensitive OR-match of `q` across `fields`. Empty when `q` is absent.
export function searchFilter<T>(q: string | undefined, fields: string[]): FilterQuery<T> {
  if (!q || fields.length === 0) return {} as FilterQuery<T>;
  const rx = new RegExp(escapeRegExp(q), "i");
  return { $or: fields.map((f) => ({ [f]: rx })) } as FilterQuery<T>;
}

// Inclusive UTC date range on `field`. A date-only `to` (UTC midnight) is
// extended to the end of that day so the upper bound includes the whole day.
export function dateRangeFilter<T>(field: string, from?: Date, to?: Date): FilterQuery<T> {
  if (!from && !to) return {} as FilterQuery<T>;
  const range: Record<string, Date> = {};
  if (from) range.$gte = from;
  if (to) {
    const isMidnightUtc =
      to.getUTCHours() === 0 &&
      to.getUTCMinutes() === 0 &&
      to.getUTCSeconds() === 0 &&
      to.getUTCMilliseconds() === 0;
    range.$lte = isMidnightUtc ? new Date(to.getTime() + 86_400_000 - 1) : to;
  }
  return { [field]: range } as FilterQuery<T>;
}

// Combine partial filters, dropping empties, into a single `$and` (or the lone
// non-empty filter / `{}`).
export function mergeFilters<T>(...filters: Array<FilterQuery<T>>): FilterQuery<T> {
  const parts = filters.filter((f) => f && Object.keys(f).length > 0);
  if (parts.length === 0) return {} as FilterQuery<T>;
  if (parts.length === 1) return parts[0];
  return { $and: parts } as FilterQuery<T>;
}

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// Run a paginated find + count in parallel and return the uniform envelope.
// `T` is the (lean) row type the caller expects back; pass it explicitly.
export async function paginate<T = unknown>(
  model: QueryableModel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter: FilterQuery<any>,
  opts: { params: ListParams; sort?: Record<string, SortOrder>; select?: string },
): Promise<Page<T>> {
  const { page, pageSize } = opts.params;
  const query = model.find(filter);
  if (opts.select) query.select(opts.select);
  if (opts.sort) query.sort(opts.sort);
  const [items, total] = await Promise.all([
    query
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    model.countDocuments(filter),
  ]);
  return {
    items: items as T[],
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// Paginated aggregation: applies a `$match` (search/filters/date) first, then a
// `$facet` that pages the rows (sort → skip → limit → caller's lookups/project)
// and counts the total. Lookups run AFTER skip/limit, so they only touch the
// page. Returns the same envelope as `paginate`.
export async function paginateAggregate<T = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: { aggregate: (pipeline: any[]) => { exec: () => Promise<any[]> } | Promise<any[]> },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  match: Record<string, any>,
  // Stages applied to the page rows (e.g. $lookup/$project). No sort/skip/limit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pageStages: any[],
  opts: { params: ListParams; sort: Record<string, 1 | -1> },
): Promise<Page<T>> {
  const { page, pageSize } = opts.params;
  const result = (await model.aggregate([
    { $match: match },
    {
      $facet: {
        items: [
          { $sort: opts.sort },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          ...pageStages,
        ],
        total: [{ $count: "n" }],
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ])) as any[];
  const facet = result[0] ?? {};
  const items = (facet.items ?? []) as T[];
  const total = (facet.total?.[0]?.n ?? 0) as number;
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// An org's configured default page size (settings.pagination.pageSize), or 10.
export function getOrgPageSize(org: { settings?: unknown } | null | undefined): number {
  const s = (org?.settings ?? {}) as { pagination?: { pageSize?: unknown } };
  return clampInt(s?.pagination?.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
}
