// Platform-admin agents page. Server component: lists all agents across every
// org with owning org, website domain, and conversation count from /admin/agents.
import { api, ApiError } from "@/lib/api";
import { formatNumber } from "@/components/admin/utils";

type AdminAgent = {
  _id: string;
  name: string;
  model?: string;
  isActive?: boolean;
  createdAt?: string;
  organizationName?: string;
  websiteDomain?: string;
  conversationCount: number;
};

async function loadAgents(): Promise<{ agents: AdminAgent[]; error: string | null }> {
  try {
    const { items } = await api.get<{ items: AdminAgent[]; nextCursor: string | null }>(
      "/admin/agents?limit=100",
    );
    return { agents: items, error: null };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Failed to load agents";
    return { agents: [], error: message };
  }
}

export default async function AdminAgentsPage() {
  const { agents, error } = await loadAgents();

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatNumber(agents.length)} loaded · across all tenants
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Agent</th>
              <th className="px-4 py-2.5 font-medium">Organization</th>
              <th className="px-4 py-2.5 font-medium">Website</th>
              <th className="px-4 py-2.5 font-medium">Model</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium text-right">Conversations</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {agents.map((a) => (
              <tr key={a._id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium">{a.name}</td>
                <td className="px-4 py-2.5">{a.organizationName ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{a.websiteDomain ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.model ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-xs ${
                      a.isActive
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {a.isActive ? "active" : "inactive"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">{formatNumber(a.conversationCount)}</td>
              </tr>
            ))}
            {agents.length === 0 && !error ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  No agents yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
