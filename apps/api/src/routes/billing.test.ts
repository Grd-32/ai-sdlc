import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types.js";

const mocks = vi.hoisted(() => ({
  subscriptionFindUnique: vi.fn(),
  subscriptionUpsert: vi.fn(),
  subscriptionDatabaseUpdate: vi.fn(),
  stripeSubscriptionUpdate: vi.fn(),
  organizationFindUniqueOrThrow: vi.fn(),
  customerCreate: vi.fn(),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    billingSubscription: {
      findUnique: mocks.subscriptionFindUnique,
      upsert: mocks.subscriptionUpsert,
      update: mocks.subscriptionDatabaseUpdate,
    },
    organization: { findUniqueOrThrow: mocks.organizationFindUniqueOrThrow },
  },
  recordAuditEvent: mocks.audit,
}));

vi.mock("../billing/stripe.js", () => ({
  getStripeClient: () => ({
    customers: { create: mocks.customerCreate },
    checkout: { sessions: { create: mocks.checkoutCreate } },
    billingPortal: { sessions: { create: mocks.portalCreate } },
    subscriptions: { update: mocks.stripeSubscriptionUpdate },
  }),
  getAppBaseUrl: () => "https://app.example.test",
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: async (
    c: { set: (key: string, value: string) => void },
    next: () => Promise<void>,
  ) => {
    c.set("userId", "billing-test-user");
    await next();
  },
  requireOrganizationRole:
    () => async (c: { set: (key: string, value: string) => void }, next: () => Promise<void>) => {
      c.set("organizationId", "billing-test-org");
      c.set("organizationRole", "OWNER");
      await next();
    },
}));

const { registerBillingRoutes } = await import("./billing.js");

describe("billing routes", () => {
  const app = new Hono<AppEnv>();
  registerBillingRoutes(app);

  beforeEach(() => {
    delete process.env["STRIPE_PRICE_PROFESSIONAL"];
    delete process.env["STRIPE_SECRET_KEY"];
    vi.clearAllMocks();
    mocks.subscriptionFindUnique.mockResolvedValue(null);
    mocks.subscriptionUpsert.mockResolvedValue({});
    mocks.subscriptionDatabaseUpdate.mockResolvedValue({});
    mocks.stripeSubscriptionUpdate.mockResolvedValue({ cancel_at_period_end: true });
    mocks.organizationFindUniqueOrThrow.mockResolvedValue({
      name: "Test organization",
      slug: "test-organization",
    });
    mocks.customerCreate.mockResolvedValue({ id: "cus_test" });
    mocks.checkoutCreate.mockResolvedValue({
      id: "cs_test",
      url: "https://checkout.stripe.test/session",
    });
    mocks.portalCreate.mockResolvedValue({ url: "https://billing.stripe.test/portal" });
  });

  it("publishes configured plan names and does not expose Stripe price IDs", async () => {
    process.env["STRIPE_PRICE_PROFESSIONAL"] = "price_test_secret";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_configured";
    const response = await app.request("/api/billing/plans");
    const body = (await response.json()) as {
      data: Array<{ id: string; selfServeCheckout: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(body.data.map(({ id }) => id)).toEqual([
      "FREE_ASSESSMENT",
      "PROFESSIONAL",
      "ENTERPRISE",
    ]);
    expect(body.data[1]?.selfServeCheckout).toBe(true);
    expect(JSON.stringify(body)).not.toContain("price_test_secret");
  });

  it("does not create checkout sessions unless the server has a configured Stripe Price", async () => {
    const response = await app.request("/api/organizations/billing-test-org/billing/checkout", {
      method: "POST",
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("BILLING_NOT_CONFIGURED");
  });

  it("creates hosted checkout with the server Price and ignores a client-supplied Price", async () => {
    process.env["STRIPE_PRICE_PROFESSIONAL"] = "price_server_configured";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_configured";
    const response = await app.request("/api/organizations/billing-test-org/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priceId: "price_client_supplied" }),
    });
    const body = (await response.json()) as { data: { url: string } };

    expect(response.status).toBe(201);
    expect(body.data.url).toBe("https://checkout.stripe.test/session");
    expect(mocks.customerCreate.mock.calls[0]?.[0]).toMatchObject({
      metadata: { organizationId: "billing-test-org" },
    });
    expect(mocks.customerCreate.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: "nomalog-customer-billing-test-org",
    });
    expect(mocks.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_server_configured", quantity: 1 }],
        client_reference_id: "billing-test-org",
      }),
    );
    expect(JSON.stringify(mocks.checkoutCreate.mock.calls)).not.toContain("price_client_supplied");
  });

  it("opens the Stripe portal for an existing customer even when paid access is paused", async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({
      provider: "STRIPE",
      providerCustomerId: "cus_test",
      status: "PAST_DUE",
    });
    const response = await app.request("/api/organizations/billing-test-org/billing/portal", {
      method: "POST",
    });
    const body = (await response.json()) as { data: { url: string } };

    expect(response.status).toBe(200);
    expect(body.data.url).toBe("https://billing.stripe.test/portal");
  });

  it("schedules cancellation with Stripe and audits the organization action", async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({
      provider: "STRIPE",
      providerSubscriptionId: "sub_test",
      status: "ACTIVE",
    });
    const response = await app.request("/api/organizations/billing-test-org/billing/cancel", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(mocks.stripeSubscriptionUpdate).toHaveBeenCalledWith("sub_test", {
      cancel_at_period_end: true,
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "billing-test-org",
        eventType: "BILLING_CANCELLATION_SCHEDULED",
      }),
    );
  });
});
