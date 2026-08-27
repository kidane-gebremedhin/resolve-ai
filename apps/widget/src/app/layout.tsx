import type { Metadata } from "next";
import { sansFont, displayFont } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat widget",
};

// The widget only ever renders inside an iframe, so no user sees this icon —
// but without one the browser still requests /favicon.ico on every load and
// logs a 404 in the host page's console. `icon.svg` (Next's file convention)
// emits a <link rel="icon">, which stops the request.

// The widget shares the platform's global font. It reads the admin-chosen body /
// heading fonts from the public theming endpoint when reachable, falling back to
// the defaults so the embedded widget always renders.
async function getTheming(): Promise<{ fontSans?: string; fontDisplay?: string }> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL;
    if (!base) return {};
    const res = await fetch(`${base}/public/theming`, { cache: "no-store" });
    if (!res.ok) return {};
    return (await res.json()) as { fontSans?: string; fontDisplay?: string };
  } catch {
    return {};
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theming = await getTheming();
  const sans = sansFont(theming.fontSans);
  const display = displayFont(theming.fontDisplay);

  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
