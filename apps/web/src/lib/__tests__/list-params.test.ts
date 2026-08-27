// Query-string building for the paginated admin lists.
//
// Small, but it sits between a URL a user can type anything into and an API
// call, so the allow-list behaviour is the part worth pinning down.

import { describe, expect, it } from "vitest";
import { buildListQuery } from "../list-params";

describe("buildListQuery", () => {
  it("keeps only the keys the list supports", () => {
    // Anything else in the URL is ignored rather than forwarded — an endpoint
    // should not receive parameters because someone pasted them in.
    const q = buildListQuery({ page: "2", search: "ada", nonsense: "x" }, ["page", "search"]);
    expect(q).toBe("page=2&search=ada");
  });

  it("takes the first value when a key repeats", () => {
    expect(buildListQuery({ page: ["3", "9"] }, ["page"])).toBe("page=3");
  });

  it("drops empty and missing values rather than sending blanks", () => {
    expect(buildListQuery({ page: "", search: undefined }, ["page", "search"])).toBe("");
  });

  it("url-encodes values", () => {
    expect(buildListQuery({ search: "a b&c" }, ["search"])).toBe("search=a+b%26c");
  });

  it("preserves the declared key order, so the same filters cache alike", () => {
    const a = buildListQuery({ search: "x", page: "1" }, ["page", "search"]);
    const b = buildListQuery({ page: "1", search: "x" }, ["page", "search"]);
    expect(a).toBe(b);
  });
});
