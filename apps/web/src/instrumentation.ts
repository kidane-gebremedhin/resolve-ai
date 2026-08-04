import * as Sentry from "@sentry/nextjs";

// Next.js instrumentation — runs once when the server process starts (dev and
// standalone/production).
//
// Network hardening for dual-stack hosts: on machines with broken or absent IPv6
// routing, Node's Happy-Eyeballs (`autoSelectFamily`, default-on since Node 20)
// stalls when it races an unreachable IPv6 address instead of falling back to
// IPv4. That surfaces as `[auth][error] TypeError: fetch failed` (ETIMEDOUT)
// when NextAuth calls dual-stack OAuth endpoints like accounts.google.com — even
// though IPv4-only hosts and `curl` work fine. Preferring IPv4 and disabling the
// racing makes outbound fetches connect reliably.
//
// It also boots Sentry for the server runtimes. The configs are imported
// dynamically (not statically) so the Edge bundle never pulls in the Node build
// of the SDK, and vice versa.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const net = await import("node:net");
    const dns = await import("node:dns");
    try {
      dns.setDefaultResultOrder("ipv4first");
      net.setDefaultAutoSelectFamily(false);
    } catch {
      // Older/newer Node without these APIs — best effort.
    }
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Next.js calls this for every error thrown while rendering a route on the
// server (server components, route handlers, server actions). Without it those
// errors are logged to stdout and never reach Sentry.
export const onRequestError = Sentry.captureRequestError;
