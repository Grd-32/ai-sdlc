import { describe, it, expect } from "vitest";
import { JOB_TYPES, QUEUE_NAMES } from "./config.js";

describe("Worker config", () => {
  it("defines health check job type", () => {
    expect(JOB_TYPES.HEALTH_CHECK).toBe("system.health.check");
  });

  it("uses github queue name", () => {
    expect(QUEUE_NAMES.GITHUB).toBe("github");
  });
});
