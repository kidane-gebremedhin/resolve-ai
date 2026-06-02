"use client";

// Browser-only Paddle.js loader. Lazily initializes Paddle (overlay checkout)
// and caches the instance for the lifetime of the page. Reads configuration
// from `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` and `NEXT_PUBLIC_PADDLE_ENV`.
//
// The SDK is imported dynamically (not at module top-level) because
// `@paddle/paddle-js` evaluates `React.createContext` at load time, which
// fails inside Next.js's SSR data-collection pass even for client components.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PaddleInstance = any;

let paddleInstance: PaddleInstance | undefined;
let paddleInitPromise: Promise<PaddleInstance | undefined> | undefined;

export function isPaddleConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN);
}

/**
 * Returns a cached Paddle instance, initializing it on the first call.
 * Resolves to `undefined` when the client token is not configured so callers
 * can render disabled UI rather than throwing.
 */
export async function getPaddle(): Promise<PaddleInstance | undefined> {
  if (paddleInstance) return paddleInstance;
  if (typeof window === "undefined") return undefined;
  if (!process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN) return undefined;

  if (!paddleInitPromise) {
    paddleInitPromise = import("@paddle/paddle-js").then(({ initializePaddle }) =>
      initializePaddle({
        environment:
          (process.env.NEXT_PUBLIC_PADDLE_ENV as "sandbox" | "production" | undefined) ?? "sandbox",
        token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN as string,
      }).then((p) => {
        paddleInstance = p;
        return p;
      }),
    );
  }
  return paddleInitPromise;
}

export type OpenCheckoutArgs = {
  priceId: string;
  customData: { organizationId: string } & Record<string, unknown>;
  successUrl?: string;
};

/**
 * Opens Paddle's overlay checkout for a single-item subscription. Throws when
 * Paddle isn't configured so the caller can surface a clear error toast.
 */
export async function openCheckout(args: OpenCheckoutArgs): Promise<void> {
  const paddle = await getPaddle();
  if (!paddle) {
    throw new Error(
      "Paddle is not configured. Set NEXT_PUBLIC_PADDLE_CLIENT_TOKEN to enable checkout.",
    );
  }
  paddle.Checkout.open({
    items: [{ priceId: args.priceId, quantity: 1 }],
    customData: args.customData,
    settings: args.successUrl ? { successUrl: args.successUrl } : undefined,
  });
}
