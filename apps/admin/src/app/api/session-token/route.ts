import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Exposes ONLY the bearer access token for client-side fetches.
// Never serialise the full session here.
export async function GET() {
  const session = await auth();
  return NextResponse.json({ accessToken: session?.accessToken ?? null });
}
