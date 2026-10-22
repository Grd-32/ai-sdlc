import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventCreate: vi.fn(),
  eventUpdateMany: vi.fn(),
  eventUpdate: vi.fn(),
  subscriptionRetrieve: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  subscriptionUpsert: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    billingWebhookEvent: {
      create: mocks.eventCreate,
      updateMany: mocks.eventUpdateMany,
      update: mocks.eventUpdate,
    },
    billingSubscription: {
      findFirst: vi.fn(),
      findUnique: mocks.subscriptionFindUnique,
      upsert: mocks.subscriptionUpsert,
    },
  },
}));

vi.mock("./stripe.js", () => ({
  getStripeClient: () => ({
    subscriptions: { retrieve: mocks.subscriptionRetrieve },
  }),
}));

const { processStripeEvent } = await import("./webhook.js");

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_test_1",
    type: "product.updated",
    data: { object: { id: "prod_test" } },
    ...overrides,
  };
}

describe("Stripe webhook event processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventCreate.mockResolvedValue({});
    mocks.eventUpdateMany.mockResolvedValue({ count: 1 });
    mocks.eventUpdate.mockResolvedValue({});
    mocks.subscriptionFindUnique.mockResolvedValue(null);
    mocks.subscriptionUpsert.mockResolvedValue({});
  });

  it("persists and marks a verified event processed", async () => {
    await processStripeEvent(buildEvent() as never);

    expect(mocks.eventCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        providerEventId: "evt_test_1",
        eventType: "product.updated",
      },
    });
    expect(mocks.eventUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { providerEventId: "evt_test_1" },
      data: { status: "PROCESSING" },
    });
    expect(mocks.eventUpdate.mock.calls.at(-1)?.[0]).toMatchObject({
      where: { providerEventId: "evt_test_1" },
      data: { status: "PROCESSED" },
    });
  });

  it("does not process duplicate deliveries while already claimed or completed", async () => {
    mocks.eventCreate.mockRejectedValue({ code: "P2002" });
    mocks.eventUpdateMany.mockResolvedValue({ count: 0 });

    await expect(processStripeEvent(buildEvent() as never)).resolves.toBeUndefined();
    expect(mocks.eventUpdate).not.toHaveBeenCalled();
  });

  it("records provider processing failures for retries", async () => {
    mocks.subscriptionRetrieve.mockRejectedValue(new Error("Stripe unavailable"));

    await expect(
      processStripeEvent(
        buildEvent({
          type: "customer.subscription.updated",
          data: { object: { id: "sub_test", metadata: { organizationId: "org_test" } } },
        }) as never,
      ),
    ).rejects.toThrow("Stripe unavailable");
    expect(mocks.eventUpdate.mock.calls.at(-1)?.[0]).toMatchObject({
      where: { providerEventId: "evt_test_1" },
      data: { status: "FAILED", lastError: "Stripe unavailable" },
    });
  });

  it("does not let an older subscription event replace the newer subscription", async () => {
    const subscription = (id: string, created: number) => ({
      id,
      created,
      customer: "cus_test",
      metadata: { organizationId: "org_test" },
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_start: 1_800_000_000,
            current_period_end: 1_802_592_000,
            price: { id: "price_test" },
          },
        ],
      },
    });
    mocks.subscriptionFindUnique.mockResolvedValue({
      provider: "STRIPE",
      providerSubscriptionId: "sub_new",
    });
    mocks.subscriptionRetrieve
      .mockResolvedValueOnce(subscription("sub_old", 100))
      .mockResolvedValueOnce(subscription("sub_new", 200));

    await processStripeEvent(
      buildEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "sub_old", metadata: { organizationId: "org_test" } } },
      }) as never,
    );

    expect(mocks.subscriptionUpsert.mock.calls[0]?.[0]).toMatchObject({
      update: { providerSubscriptionId: "sub_new" },
    });
  });

  it("marks expired incomplete subscriptions inactive so checkout can be retried", async () => {
    mocks.subscriptionRetrieve.mockResolvedValue({
      id: "sub_expired",
      created: 100,
      customer: "cus_test",
      metadata: { organizationId: "org_test" },
      status: "incomplete_expired",
      cancel_at_period_end: false,
      items: { data: [{ price: { id: "price_test" } }] },
    });

    await processStripeEvent(
      buildEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "sub_expired", metadata: { organizationId: "org_test" } } },
      }) as never,
    );

    expect(mocks.subscriptionUpsert.mock.calls[0]?.[0]).toMatchObject({
      update: { status: "INACTIVE" },
    });
  });
});
