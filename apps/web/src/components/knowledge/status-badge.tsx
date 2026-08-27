// Status pill used in both the list and detail views. Colors per spec:
//   pending  -> gray
//   processing -> blue + pulse
//   synced   -> green
//   empty    -> amber (read fine, but retrieves nothing — a failure, not a success)
//   error    -> red
//   deleting -> orange

import type { KbStatus } from "./types";

const styles: Record<KbStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse",
  synced: "bg-success/10 text-success",
  empty: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  error: "bg-destructive/10 text-destructive",
  deleting: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
};

const labels: Record<KbStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  synced: "Synced",
  empty: "No text found",
  error: "Error",
  deleting: "Deleting",
};

export function StatusBadge({ status }: { status: KbStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
