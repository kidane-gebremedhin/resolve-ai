// Outbound-request guard for every server-side fetch to a URL a tenant or a
// visitor can influence (custom webhooks, link previews, the widget's section
// proxy).
//
// The earlier guard checked the hostname once and then handed the URL to
// fetch(), which (a) followed redirects to anywhere, (b) resolved DNS again
// (rebinding window), (c) parsed IPv6 answers as IPv4 and let them through, and
// (d) did not block 0.0.0.0, which reaches localhost on Linux. `safeFetch`
// closes all four: it validates the address the socket actually connects to,
// follows redirects by hand and re-checks every hop, and caps the body size.
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";

type V4Range = [number, number];

// [network, prefix length]
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"; 0.0.0.0 reaches localhost on Linux
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0) >>> 0;
}

const V4_RANGES: V4Range[] = BLOCKED_V4.map(([base, bits]) => {
  const start = v4ToInt(base);
  const size = 2 ** (32 - bits);
  return [start, start + size - 1];
});

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

/** Expands an IPv6 literal to 8 hextets. Handles `::` and an embedded IPv4 tail. */
function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const n = v4ToInt(v4[1]);
    addr = addr.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const parts = addr.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  return groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g || g.length !== 8 || g.some((x) => Number.isNaN(x))) return true; // unparseable: refuse
  const embeddedV4 = (hi: number, lo: number) =>
    `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isBlockedV4(embeddedV4(g[6], g[7]));
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return isBlockedV4(embeddedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isBlockedV4(embeddedV4(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/** True for any address a server-side request must never reach. */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true;
}

export type SafeUrlOptions = {
  /** Allow plain http:. Webhooks stay https-only; the section proxy allows http. */
  allowHttp?: boolean;
};

function parseUrl(urlStr: string, opts: SafeUrlOptions): URL {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error(`SSRF guard: invalid URL: ${urlStr}`);
  }
  const okProtocol = url.protocol === "https:" || (opts.allowHttp && url.protocol === "http:");
  if (!okProtocol) {
    throw new Error(
      opts.allowHttp
        ? `SSRF guard: only http(s) URLs are allowed (got ${url.protocol})`
        : `SSRF guard: only HTTPS URLs are allowed (got ${url.protocol})`,
    );
  }
  if (url.username || url.password) throw new Error("SSRF guard: credentials in URL are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error(`SSRF guard: blocked hostname: ${host}`);
  }
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new Error(`SSRF guard: blocked private IP: ${host}`);
  }
  return url;
}

/**
 * Throws if the URL is unsafe for an outbound request: wrong scheme, a private
 * or reserved literal address, or a hostname that resolves to one. Prefer
 * `safeFetch`, which also enforces this at connect time.
 */
export async function assertSafeUrl(urlStr: string, opts: SafeUrlOptions = {}): Promise<void> {
  const url = parseUrl(urlStr, opts);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return;
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOTFOUND") {
      throw new Error(`SSRF guard: hostname not found: ${host}`);
    }
    throw err;
  }
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) {
      throw new Error(`SSRF guard: hostname ${host} resolves to private IP ${a.address}`);
    }
  }
}

// DNS lookup used by the outbound socket itself, so the address checked is the
// address connected to (no window for a rebinding DNS server).
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...(options as dns.LookupOptions), all: true, verbatim: true }, (err, addresses) => {
    if (err) return (callback as (e: Error | null, a?: unknown, f?: number) => void)(err);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad || list.length === 0) {
      return (callback as (e: Error | null) => void)(
        new Error(`SSRF guard: ${hostname} resolves to a blocked address`),
      );
    }
    if ((options as dns.LookupOptions)?.all) {
      return (callback as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    }
    return (callback as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
  });
};

export type SafeFetchInit = SafeUrlOptions & {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Response bodies larger than this are rejected. Default 5 MB. */
  maxBytes?: number;
  /** Default 3. Each hop is re-validated. */
  maxRedirects?: number;
};

function requestOnce(url: URL, init: SafeFetchInit): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}> {
  const mod = url.protocol === "https:" ? https : http;
  const maxBytes = init.maxBytes ?? 5 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        lookup: guardedLookup,
        timeout: init.timeoutMs ?? 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new Error("SSRF guard: response too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/**
 * fetch() replacement for user-influenced URLs. Returns a standard `Response`.
 * Throws on a blocked destination at any hop, too many redirects, a timeout or
 * an oversized body.
 */
export async function safeFetch(urlStr: string, init: SafeFetchInit = {}): Promise<Response> {
  let url = parseUrl(urlStr, init);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const maxRedirects = init.maxRedirects ?? 3;

  for (let hop = 0; ; hop += 1) {
    const res = await requestOnce(url, { ...init, method, body });
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) throw new Error("SSRF guard: too many redirects");
      url = parseUrl(new URL(location, url).toString(), init);
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined) continue;
      for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
    }
    const noBody = res.status === 204 || res.status === 304 || method === "HEAD";
    return new Response(noBody ? null : new Uint8Array(res.body), { status: res.status, headers });
  }
}
