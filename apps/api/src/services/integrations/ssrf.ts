import { lookup } from "node:dns/promises";

// RFC1918 + loopback + link-local ranges that are unsafe for server-side fetches.
const BLOCKED_RANGES: [number, number][] = [
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local)
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 (multicast)
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (shared address space)
];

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function isBlockedIp(ip: string): boolean {
  const n = ipToInt(ip);
  return BLOCKED_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

/**
 * Throws if the URL is unsafe for an outbound server-side HTTP request.
 * Blocks: non-HTTPS, private/loopback IPs, localhost hostnames.
 * Call this before any fetch to a user-supplied URL (webhook endpoints, OG preview, etc.).
 */
export async function assertSafeUrl(urlStr: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error(`SSRF guard: invalid URL: ${urlStr}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`SSRF guard: only HTTPS URLs are allowed (got ${url.protocol})`);
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname === "localhost" || hostname === "::1") {
    throw new Error(`SSRF guard: blocked hostname: ${hostname}`);
  }

  // If it looks like a raw IP address, check directly.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`SSRF guard: blocked private IP: ${hostname}`);
    }
    return;
  }

  // DNS resolve and check all returned addresses.
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isBlockedIp(addr.address)) {
        throw new Error(`SSRF guard: hostname ${hostname} resolves to private IP ${addr.address}`);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOTFOUND") {
      throw new Error(`SSRF guard: hostname not found: ${hostname}`);
    }
    throw err;
  }
}
