import { describe, it, expect } from "vitest";
import { cn, getApiUrl } from "./utils";

describe("web utils", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("returns default API URL", () => {
    expect(getApiUrl()).toBe("http://localhost:3001");
  });
});
