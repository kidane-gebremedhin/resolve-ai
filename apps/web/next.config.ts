import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@csb/ui", "@csb/shared-types"],
  outputFileTracingRoot: process.env.NEXT_OUTPUT_FILE_TRACING_ROOT,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        // Allow the widget proxy (back.chataxis.pro) to load any Next.js static
        // asset (fonts, chunks, CSS) from chataxis.pro without CORS errors.
        // Covers /_next/static/media/ (fonts), /_next/static/css/, /_next/static/chunks/.
        source: "/_next/static/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

// Sentry build plugin. Everything here is build-time only: it injects the SDK
// into the server/client bundles and — when SENTRY_AUTH_TOKEN is present —
// uploads source maps so production stack traces are readable instead of
// minified. Deploys without the token still build and still report errors; they
// just show compiled frames.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // No token → nothing to upload; skip the step instead of failing the build.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Keep `next build` output quiet locally, verbose in CI where the log matters.
  silent: !process.env.CI,
  // Picks up files loaded by the client outside the default upload scope
  // (relevant here because standalone output moves .next/static around).
  widenClientFileUpload: true,
  // Route browser events through this app's own origin. Ad blockers block
  // requests to *.ingest.sentry.io outright, which would silently drop errors
  // from a meaningful share of real users — and from the test page.
  tunnelRoute: "/monitoring",
  webpack: {
    // Tree-shake Sentry's own debug logging out of the client bundle.
    treeshake: { removeDebugLogging: true },
    // Vercel-only feature; this app runs on Coolify.
    automaticVercelMonitors: false,
  },
});
