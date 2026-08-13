"use client";

// Explicit client boundary for the toast host.
//
// The root layout is a server component. Rendering @csb/ui's <Toaster> directly
// from there relies on the workspace package's own "use client" directive
// surviving transpilation, which it did not — the module showed up in the RSC
// payload but the host element never mounted in the DOM. Declaring the boundary
// here, inside the app, makes it unambiguous.

import { Toaster } from "@csb/ui";

export function ToasterHost() {
  return (
    <Toaster
      position="top-right"
      // Distinct palettes for error vs success — an error that looks like every
      // other notification gets skimmed past.
      richColors
      // Errors people need to act on shouldn't time out before they're read.
      closeButton
    />
  );
}
