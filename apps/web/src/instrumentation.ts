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
  }
}
