"use client";

// Widget iframe entry point. Reads embed config from the URL and mounts the
// orchestrator. `useSearchParams` requires a Suspense boundary in Next.js 16,
// hence the split between the default export and `<WidgetEntry />`.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { WidgetRoot } from "../components/WidgetRoot";
import { BootScreen } from "../components/BootScreen";

function WidgetEntry() {
  const params = useSearchParams();
  // The embed script forwards these as query params; the widget tolerates
  // missing values and falls back to a localhost-friendly default for `domain`
  // so visiting /?{nothing} during development still renders the boot screen.
  const domain = params.get("domain") ?? "customer-service-chatbot.dev";
  const agentId = params.get("agentId") ?? undefined;
  const websiteId = params.get("websiteId") ?? undefined;
  const theme =
    (params.get("theme") as "light" | "dark" | "auto" | null) ?? undefined;
  const positionParam = params.get("position");
  const position: "bottom-right" | "bottom-left" | "centered" =
    positionParam === "bottom-left"
      ? "bottom-left"
      : positionParam === "centered"
        ? "centered"
        : "bottom-right";
  const primaryColor = params.get("primaryColor") ?? undefined;
  const headerStyleParam = params.get("headerStyle");
  const headerStyle: "pinstripe" | "solid" | undefined =
    headerStyleParam === "solid" ? "solid" : headerStyleParam === "pinstripe" ? "pinstripe" : undefined;

  return (
    <WidgetRoot
      domain={domain}
      agentId={agentId}
      websiteId={websiteId}
      theme={theme}
      position={position}
      primaryColor={primaryColor}
      headerStyle={headerStyle}
    />
  );
}

export default function WidgetPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 sm:bottom-4 sm:right-4 sm:inset-auto sm:h-[600px] sm:w-[400px] sm:rounded-2xl overflow-hidden bg-white shadow-2xl">
          <BootScreen />
        </div>
      }
    >
      <WidgetEntry />
    </Suspense>
  );
}
