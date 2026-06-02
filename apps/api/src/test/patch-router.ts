// Side-effect-only module: monkey-patches express's `Router` so that async
// handlers throwing rejected promises forward to `next(err)` automatically.
//
// Why we need this in tests:
// The codebase mixes two patterns — `widget.routes.ts` uses an explicit
// `asyncHandler(...)` wrapper, but other route files (`auth`, `website`,
// `conversation`, `agent`, `kb`, ...) write `async (req, res) => { throw ... }`
// directly. Under Express 4 (which this app pins via `^4.21`), rejected
// promises returned from a route handler are NOT forwarded to error
// middleware — only Express 5 does that natively. In a real `listen()`-ing
// server those throws manifest as unhandled rejections + hung requests. In
// tests we want the errors to land in `errorHandler` so we can assert
// `res.status`. We achieve that by wrapping every handler registered after
// this module loads.
//
// IMPORTANT: Express 4 attaches method handlers (`use`, `get`, `post`, …)
// directly to the exported `Router` function — NOT to `Router.prototype`.
// Each `Router()` call returns a fresh function whose `[[Prototype]]` is
// set to `Router` via `setPrototypeOf`. So we patch `Router` itself (and
// `Route.prototype` for `router.route(path).get(...)` style chains).

import { Router } from "express";

function wrap(handler: unknown): unknown {
  if (typeof handler !== "function") return handler;
  // Error-handling middleware has arity 4. Don't wrap those — Express
  // dispatches them based on .length === 4.
  if ((handler as { length: number }).length >= 4) return handler;
  const fn = handler as (...args: unknown[]) => unknown;
  // We can't use a typed RequestHandler signature because express invokes
  // handlers via `.apply(this, [req, res, next])` and we want to preserve
  // arity-preserving behaviour for params/middleware too.
  const wrapped = function patchedHandler(
    this: unknown,
    req: unknown,
    res: unknown,
    next: unknown,
  ) {
    const nextFn = next as (err?: unknown) => void;
    try {
      const ret = fn.call(this, req, res, next);
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        (ret as Promise<unknown>).catch(nextFn);
      }
    } catch (err) {
      nextFn(err);
    }
  };
  return wrapped;
}

const proto = Router as unknown as Record<string, unknown> & {
  __asyncPatched?: boolean;
};

if (!proto.__asyncPatched) {
  proto.__asyncPatched = true;

  const METHODS = [
    "use",
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "options",
    "head",
    "all",
  ] as const;

  for (const method of METHODS) {
    const orig = proto[method] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof orig !== "function") continue;
    proto[method] = function patched(this: unknown, ...args: unknown[]) {
      const mapped = args.map((a) => (typeof a === "function" ? wrap(a) : a));
      return orig.apply(this, mapped);
    };
  }

  // `router.route(path).get(handler)` style — Route is a separate constructor.
  // We patch its prototype so any method-call chain off `router.route(...)`
  // gets the same wrapping.
  // express's Route is loaded lazily and not exposed from the top-level export,
  // so we reach it via the require cache of the patched Router module.
  // (typeof Route.prototype.get etc. === "function".)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const Route = require("express/lib/router/route") as {
      prototype: Record<string, unknown>;
    };
    const ROUTE_METHODS = [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "options",
      "head",
      "all",
    ] as const;
    for (const method of ROUTE_METHODS) {
      const orig = Route.prototype[method] as
        | ((...args: unknown[]) => unknown)
        | undefined;
      if (typeof orig !== "function") continue;
      Route.prototype[method] = function patched(
        this: unknown,
        ...args: unknown[]
      ) {
        const mapped = args.map((a) => (typeof a === "function" ? wrap(a) : a));
        return orig.apply(this, mapped);
      };
    }
  } catch {
    // If express's internal layout changes, fall through — the `Router`
    // patch above still covers the common `router.<method>(path, handler)`
    // calls used in this codebase.
  }
}
