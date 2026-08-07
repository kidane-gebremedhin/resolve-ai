"use client";

// Shown on pages where the caller can read but not write, so the absence of
// create/edit/delete buttons reads as intentional rather than broken. Renders
// nothing when the caller does have the capability.

import { Eye } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { ORG_ROLE_LABEL, deniedReason, type Capability } from "@/lib/permissions";

export function ReadOnlyNotice({
  capability,
  className = "",
}: {
  capability: Capability;
  className?: string;
}) {
  const { role, can } = usePermissions();
  if (can(capability)) return null;

  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground ${className}`}
      role="status"
    >
      <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        {role ? (
          <>
            You&apos;re signed in as <strong>{ORG_ROLE_LABEL[role]}</strong>, so this page is
            read-only. {deniedReason(capability)}
          </>
        ) : (
          <>This page is read-only for your account. {deniedReason(capability)}</>
        )}
      </span>
    </div>
  );
}
