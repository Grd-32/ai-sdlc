import { afterEach, describe, expect, it, vi } from "vitest";
import { getPort } from "./config.js";

describe("getPort", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the platform-assigned PORT when provided", () => {
    vi.stubEnv("PORT", "10000");
    vi.stubEnv("API_PORT", "3001");

    expect(getPort()).toBe(10000);
  });

  it("uses API_PORT when no platform port is assigned", () => {
    vi.stubEnv("PORT", "");
    vi.stubEnv("API_PORT", "3100");

    expect(getPort()).toBe(3100);
  });

  it("defaults to the development API port", () => {
    vi.stubEnv("PORT", "");
    vi.stubEnv("API_PORT", "");

    expect(getPort()).toBe(3001);
  });
});
