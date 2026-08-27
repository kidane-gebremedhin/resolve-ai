// Formatting for the RAG Quality dashboard.
//
// One rule runs through all of it and is the reason this is tested at all:
// **null is not zero**. The whole null-vs-zero discipline in the telemetry and
// the eval harness is thrown away the moment the UI paints "no data" and "a
// rate of zero" the same way — an operator reading 0% no-hit rate on an org
// with no traffic would go looking for a problem that does not exist.

import { describe, expect, it } from "vitest";
import { NO_DATA, count, deltaBadge, ms, num, pct, usd } from "./format";

describe("null is not zero", () => {
  it.each([
    ["pct", pct],
    ["num", num],
    ["ms", ms],
    ["usd", usd],
    ["count", count],
  ])("%s renders no-data for null, undefined and NaN", (_name, fn) => {
    expect(fn(null)).toBe(NO_DATA);
    expect(fn(undefined)).toBe(NO_DATA);
    expect(fn(Number.NaN)).toBe(NO_DATA);
  });

  it.each([
    ["pct", pct, "0%"],
    ["num", num, "0.00"],
    ["ms", ms, "0ms"],
    ["usd", usd, "$0.0000"],
    ["count", count, "0"],
  ])("%s still renders a real zero as a number", (_name, fn, expected) => {
    expect(fn(0)).toBe(expected);
    expect(fn(0)).not.toBe(NO_DATA);
  });
});

describe("units", () => {
  it("renders percentages at the requested precision", () => {
    expect(pct(0.256)).toBe("26%");
    expect(pct(0.256, 1)).toBe("25.6%");
    expect(pct(1)).toBe("100%");
  });

  it("switches milliseconds to seconds once they stop being readable", () => {
    expect(ms(940)).toBe("940ms");
    expect(ms(1000)).toBe("1.0s");
    expect(ms(11430)).toBe("11.4s");
  });

  it("keeps enough decimal places for per-turn costs to be visible", () => {
    // Rounding to cents would render every realistic per-turn cost as $0.00.
    expect(usd(0.0126)).toBe("$0.0126");
    expect(usd(0.0126, 2)).toBe("$0.01");
  });

  it("groups large counts", () => {
    expect(count(644074)).toBe("644,074");
  });
});

describe("deltaBadge", () => {
  it("has nothing to say when there is nothing to compare", () => {
    expect(deltaBadge(null, (n) => pct(n))).toBeNull();
    expect(deltaBadge(undefined, (n) => pct(n))).toBeNull();
  });

  it("signs a real movement in the metric's own units", () => {
    expect(deltaBadge(0.13, (n) => pct(n))).toEqual({ text: "+13%", raw: 0.13 });
    expect(deltaBadge(-0.13, (n) => pct(n))).toEqual({ text: "-13%", raw: -0.13 });
  });

  it("reports a change that rounds away as no change, not as a signed zero", () => {
    // "-0.00" and "-0%" read as a movement in a direction, which is exactly the
    // wrong thing to tell an operator watching for a regression.
    expect(deltaBadge(-0.0004, (n) => num(n, 2))).toEqual({ text: "no change", raw: 0 });
    expect(deltaBadge(0.001, (n) => pct(n))).toEqual({ text: "no change", raw: 0 });
    expect(deltaBadge(0, (n) => usd(n))).toEqual({ text: "no change", raw: 0 });
  });

  it("does not mistake a round number for a rounded-away one", () => {
    expect(deltaBadge(1, (n) => pct(n))).toEqual({ text: "+100%", raw: 1 });
    expect(deltaBadge(0.1, (n) => pct(n))).toEqual({ text: "+10%", raw: 0.1 });
  });
});
