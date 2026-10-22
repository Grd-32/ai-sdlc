import { afterEach, describe, expect, it } from "vitest";
import { getSiteOrigin, offerContactHref, PUBLIC_ROUTES } from "./public-site";

describe("public site configuration", () => {
  afterEach(() => {
    delete process.env["NEXT_PUBLIC_SITE_URL"];
    delete process.env["APP_URL"];
  });

  it("uses the configured canonical public origin", () => {
    process.env["NEXT_PUBLIC_SITE_URL"] = "https://nomalog.example.test/path";
    expect(getSiteOrigin()).toBe("https://nomalog.example.test");
  });

  it("routes commercial offers to a preselected sales enquiry", () => {
    expect(offerContactHref("professional")).toBe("/contact?offer=professional");
    expect(offerContactHref("enterprise")).toBe("/contact?offer=enterprise");
  });

  it("includes the public marketing destinations", () => {
    expect(PUBLIC_ROUTES).toEqual(
      expect.arrayContaining([
        "/",
        "/product",
        "/how-it-works",
        "/assessment",
        "/pricing",
        "/security",
        "/docs",
        "/contact",
        "/terms",
        "/privacy",
      ]),
    );
  });
});
