// Server-side helper: turn a page's searchParams into the query string for a
// paginated /admin/* endpoint, keeping only the keys that list supports.
export function buildListQuery(
  sp: Record<string, string | string[] | undefined>,
  keys: readonly string[],
): string {
  const p = new URLSearchParams();
  for (const k of keys) {
    const raw = sp[k];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v) p.set(k, v);
  }
  return p.toString();
}

export type ListEnvelope<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
