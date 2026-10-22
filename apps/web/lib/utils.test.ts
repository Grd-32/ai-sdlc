import { describe, it, expect } from "vitest";
import { cn, getApiUrl } from "./utils";

describe("web utils", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("returns default API URL", () => {
    const publicApiUrl = process.env["NEXT_PUBLIC_API_URL"];
    const internalApiUrl = process.env["API_INTERNAL_URL"];
    delete process.env["NEXT_PUBLIC_API_URL"];
    delete process.env["API_INTERNAL_URL"];

    try {
      expect(getApiUrl()).toBe("http://localhost:3001");
    } finally {
      if (publicApiUrl === undefined) {
        delete process.env["NEXT_PUBLIC_API_URL"];
      } else {
        process.env["NEXT_PUBLIC_API_URL"] = publicApiUrl;
      }
      if (internalApiUrl === undefined) {
        delete process.env["API_INTERNAL_URL"];
      } else {
        process.env["API_INTERNAL_URL"] = internalApiUrl;
      }
    }
  });
});
