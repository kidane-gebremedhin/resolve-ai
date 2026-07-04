import { api } from "@/lib/api";
import { ActivityLog, type ToolCallItem } from "./activity-log";
import { ClipboardList } from "lucide-react";

type ToolCallResponse = {
  items: ToolCallItem[];
  nextCursor: string | null;
  days: number;
};

// Tool call audit trail — 90-day rolling window
const DAYS = 90;

async function ActivityPage() {
  let data: ToolCallResponse = { items: [], nextCursor: null, days: DAYS };

  try {
    data = await api.get<ToolCallResponse>(
      `/analytics/tool-calls?limit=50&days=${DAYS}`,
    );
  } catch {
    // Silently fall through to empty state
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-muted">
          <ClipboardList className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Agent activity
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All AI tool invocations in the last {DAYS} days — masked arguments and result summaries.
          </p>
        </div>
      </div>

      <ActivityLog
        initialItems={data.items}
        initialCursor={data.nextCursor}
        days={DAYS}
      />
    </div>
  );
}

export default ActivityPage;
