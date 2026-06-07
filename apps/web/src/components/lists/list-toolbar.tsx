"use client";

// Reusable list controls for admin pages: a debounced search box, a UTC
// date-range filter, an optional slot for per-page filters, and a pagination
// footer. All state lives in the URL (see useListParams) so the server page can
// read it and fetch server-side. Pair with the paginated `/admin/*` endpoints.
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@csb/ui";
import { useListParams } from "./use-list-params";

export function ListToolbar({
  total,
  page,
  pageSize,
  totalPages,
  searchPlaceholder = "Search…",
  dateField = "Created",
  children,
}: {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  searchPlaceholder?: string;
  /** Label for what the date range filters on (e.g. "Created", "Last login"). */
  dateField?: string;
  /** Per-page filter controls (e.g. <FilterSelect />). */
  children?: React.ReactNode;
}) {
  const { get, set } = useListParams();
  const [q, setQ] = useState(get("q"));

  // Debounce search → URL. Only pushes when the typed value differs from the URL.
  useEffect(() => {
    const urlQ = get("q");
    const t = setTimeout(() => {
      if (q !== urlQ) set({ q: q || undefined });
    }, 350);
    return () => clearTimeout(t);
  }, [q, get, set]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            className="h-9 pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {children}

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            {dateField} from (UTC)
            <Input
              type="date"
              className="h-9 w-[150px]"
              value={get("from")}
              onChange={(e) => set({ from: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            to (UTC)
            <Input
              type="date"
              className="h-9 w-[150px]"
              value={get("to")}
              onChange={(e) => set({ to: e.target.value || undefined })}
            />
          </label>
          {(get("from") || get("to") || get("q") || get("role")) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-9"
              onClick={() => {
                setQ("");
                set({ q: undefined, from: undefined, to: undefined, role: undefined });
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <div>
          {total.toLocaleString()} result{total === 1 ? "" : "s"}
          {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => set({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => set({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        )}
      </div>
      <span className="sr-only">{pageSize} per page</span>
    </div>
  );
}

// A per-page dropdown filter bound to a URL param (e.g. role, plan, status).
export function FilterSelect({
  param,
  label,
  options,
}: {
  param: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const { get, set } = useListParams();
  const value = get(param) || "__all";
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <Select
        value={value}
        onValueChange={(v) => set({ [param]: v === "__all" ? undefined : v })}
      >
        <SelectTrigger className="h-9 w-[160px] text-sm text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
