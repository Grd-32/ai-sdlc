import Stripe from "stripe";
import { prisma } from "@ai-sdlc/db";
import { getStripeClient } from "./stripe.js";

function organizationIdFromEvent(event: Stripe.Event): string | null {
  const object = event.data.object as { metadata?: Record<string, string> | null };
  const invoiceObject = event.data.object as Stripe.Invoice;
  const value =
    object.metadata?.["organizationId"] ??
    (invoiceObject.parent?.type === "subscription_details"
      ? invoiceObject.parent.subscription_details?.metadata?.["organizationId"]
      : undefined);
  return typeof value === "string" ? value : null;
}

function mapSubscriptionStatus(status: Stripe.Subscription.Status) {
  switch (status) {
    case "active":
      return "ACTIVE" as const;
    case "trialing":
      return "TRIALING" as const;
    case "past_due":
      return "PAST_DUE" as const;
    case "unpaid":
      return "UNPAID" as const;
    case "canceled":
      return "CANCELED" as const;
    case "incomplete_expired":
    case "paused":
      return "INACTIVE" as const;
    default:
      return "INCOMPLETE" as const;
  }
}

async function syncSubscription(subscriptionId: string, fallbackOrganizationId?: string | null) {
  const stripe = getStripeClient();
  let subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const organizationId =
    subscription.metadata["organizationId"] ??
    fallbackOrganizationId ??
    (
      await prisma.billingSubscription.findFirst({
        where: {
          OR: [{ providerSubscriptionId: subscription.id }, { providerCustomerId: customerId }],
        },
        select: { organizationId: true },
      })
    )?.organizationId;
  if (!organizationId)
    throw new Error(`Stripe subscription ${subscription.id} has no organization mapping.`);

  const existing = await prisma.billingSubscription.findUnique({ where: { organizationId } });
  if (
    existing?.provider === "MANUAL" &&
    existing.plan === "ENTERPRISE" &&
    existing.currentPeriodEnd &&
    existing.currentPeriodEnd > new Date()
  ) {
    return { organizationId, subscription };
  }
  if (
    existing?.provider === "STRIPE" &&
    existing.providerSubscriptionId &&
    existing.providerSubscriptionId !== subscription.id
  ) {
    const current = await stripe.subscriptions.retrieve(existing.providerSubscriptionId);
    const currentCustomerId =
      typeof current.customer === "string" ? current.customer : current.customer.id;
    if (currentCustomerId === customerId && current.created > subscription.created) {
      subscription = current;
    }
  }

  const priceId = subscription.items.data[0]?.price.id ?? null;
  const configuredPriceId = process.env["STRIPE_PRICE_PROFESSIONAL"];
  if (
    ["active", "trialing"].includes(subscription.status) &&
    configuredPriceId &&
    priceId !== configuredPriceId
  ) {
    throw new Error(`Stripe subscription ${subscription.id} uses an unconfigured price.`);
  }
  const currentPeriodStart = subscription.items.data[0]?.current_period_start;
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end;
  const stripeStatus = mapSubscriptionStatus(subscription.status);
  await prisma.billingSubscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      plan: "PROFESSIONAL",
      status: stripeStatus,
      provider: "STRIPE",
      providerCustomerId: customerId,
      providerSubscriptionId: subscription.id,
      providerPriceId: priceId,
      currentPeriodStart: currentPeriodStart ? new Date(currentPeriodStart * 1000) : null,
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      latestInvoiceStatus: existing?.latestInvoiceStatus ?? null,
    },
    update: {
      plan: "PROFESSIONAL",
      status: stripeStatus,
      provider: "STRIPE",
      providerCustomerId: customerId,
      providerSubscriptionId: subscription.id,
      providerPriceId: priceId,
      currentPeriodStart: currentPeriodStart ? new Date(currentPeriodStart * 1000) : null,
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
  return { organizationId, subscription };
}

async function storeInvoice(invoice: Stripe.Invoice, organizationId: string) {
  const parentSubscription =
    invoice.parent?.type === "subscription_details"
      ? invoice.parent.subscription_details?.subscription
      : undefined;
  const providerSubscriptionId =
    typeof parentSubscription === "string" ? parentSubscription : parentSubscription?.id;
  if (!providerSubscriptionId || !invoice.id) return;
  const subscription = await prisma.billingSubscription.findFirst({
    where: { organizationId, providerSubscriptionId },
    select: { id: true },
  });
  if (!subscription) return;

  await prisma.billingInvoice.upsert({
    where: { providerInvoiceId: invoice.id },
    create: {
      subscriptionId: subscription.id,
      providerInvoiceId: invoice.id,
      status: invoice.status ?? "unknown",
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    },
    update: {
      status: invoice.status ?? "unknown",
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    },
  });

  await prisma.billingSubscription.update({
    where: { id: subscription.id },
    data: { latestInvoiceStatus: invoice.status ?? "unknown" },
  });
}

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  const eventOrganizationId = organizationIdFromEvent(event);
  await prisma.billingWebhookEvent
    .create({
      data: {
        providerEventId: event.id,
        eventType: event.type,
        organizationId: eventOrganizationId,
      },
    })
    .catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return;
      }
      throw error;
    });

  const staleProcessingCutoff = new Date(Date.now() - 2 * 60 * 1000);
  const acquired = await prisma.billingWebhookEvent.updateMany({
    where: {
      providerEventId: event.id,
      OR: [
        { status: { in: ["RECEIVED", "FAILED"] } },
        { status: "PROCESSING", updatedAt: { lt: staleProcessingCutoff } },
      ],
    },
    data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null },
  });
  if (acquired.count === 0) return;

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type.startsWith("customer.subscription.")
    ) {
      const object = event.data.object as Stripe.Checkout.Session | Stripe.Subscription;
      const subscriptionId =
        event.type === "checkout.session.completed"
          ? (object as Stripe.Checkout.Session).subscription
          : (object as Stripe.Subscription).id;
      const id = typeof subscriptionId === "string" ? subscriptionId : subscriptionId?.id;
      if (id) await syncSubscription(id, eventOrganizationId);
    }

    if (event.type.startsWith("invoice.") && "id" in event.data.object) {
      const invoice = event.data.object as Stripe.Invoice;
      const parentSub =
        invoice.parent?.type === "subscription_details"
          ? invoice.parent.subscription_details?.subscription
          : undefined;
      const id = typeof parentSub === "string" ? parentSub : parentSub?.id;
      let organizationId = eventOrganizationId;
      if (id) organizationId = (await syncSubscription(id, organizationId)).organizationId;
      if (organizationId) await storeInvoice(invoice, organizationId);
    }

    await prisma.billingWebhookEvent.update({
      where: { providerEventId: event.id },
      data: { status: "PROCESSED", processedAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Stripe webhook error";
    await prisma.billingWebhookEvent.update({
      where: { providerEventId: event.id },
      data: { status: "FAILED", lastError: message.slice(0, 1000) },
    });
    throw error;
  }
}
