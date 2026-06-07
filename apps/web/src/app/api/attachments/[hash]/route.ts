// Same-origin proxy for inbox attachments. The operator's <img>/download link
// can't send the NextAuth bearer header, so the browser hits this route (same
// origin, session cookie present); we resolve the session server-side and fetch
// the file from the API with the bearer token, then stream it back. This keeps
// the access token out of URLs and avoids cross-origin (CORP) issues entirely.

import { auth } from "@/lib/auth";
import { API_INTERNAL_URL } from "@/lib/app-urls";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return new Response("Not found", { status: 404 });
  }

  const session = await auth();
  const token = session?.accessToken;
  if (!token) return new Response("Unauthorized", { status: 401 });

  const upstream = await fetch(`${API_INTERNAL_URL}/messages/attachments/${hash}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return new Response("Not found", { status: upstream.status === 401 ? 401 : 404 });
  }

  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  headers.set("cache-control", "private, max-age=300");
  return new Response(upstream.body, { status: 200, headers });
}
