import type { Hono } from "hono";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { getPlanCatalog, readUsage, resolveOrganizationEntitlements } from "@ai-sdlc/billing";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { getAppBaseUrl, getStripeClient } from "../billing/stripe.js";
import type { AppEnv } from "../types.js";
import { readJsonObject } from "../request-body.js";

export function registerBillingRoutes(app: Hono<AppEnv>): void {
  app.get("/api/billing/plans", (c) =>
    c.json({
      data: getPlanCatalog().map(({ stripePriceId: _priceId, ...offer }) => offer),
      error: null,
    }),
  );

  app.get(
    "/api/organizations/:organizationId/billing",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const entitlements = await resolveOrganizationEntitlements(organizationId);
      const usage = await readUsage(organizationId, entitlements);
      const subscription = await prisma.billingSubscription.findUnique({
        where: { organizationId },
        include: { invoices: { orderBy: { createdAt: "desc" }, take: 10 } },
      });
      const mayManage = ["OWNER", "ADMIN"].includes(c.get("organizationRole"));
      const authorizedBillingAdministrators = new Set(
        (process.env["BILLING_ADMIN_USER_IDS"] ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      return c.json({
        data: {
          entitlements,
          usage,
          provider: subscription?.provider ?? null,
          hasStripeCustomer: Boolean(
            subscription?.providerCustomerId && subscription.provider === "STRIPE",
          ),
          hasStripeSubscription: Boolean(
            subscription?.providerSubscriptionId &&
            subscription.provider === "STRIPE" &&
            subscription.status !== "CANCELED" &&
            subscription.status !== "INACTIVE",
          ),
          invoices: mayManage
            ? (subscription?.invoices ?? []).map((invoice) => ({
                id: invoice.id,
                status: invoice.status,
                amountDue: invoice.amountDue,
                amountPaid: invoice.amountPaid,
                currency: invoice.currency,
                hostedInvoiceUrl: invoice.hostedInvoiceUrl,
                createdAt: invoice.createdAt,
              }))
            : [],
          canManageBilling: mayManage,
          canProvisionEnterprise: mayManage && authorizedBillingAdministrators.has(c.get("userId")),
        },
        error: null,
      });
    },
  );

  app.post(
    "/api/organizations/:organizationId/billing/checkout",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const offer = getPlanCatalog().find((item) => item.id === "PROFESSIONAL");
      if (!offer?.stripePriceId || !process.env["STRIPE_SECRET_KEY"]) {
        return c.json(
          {
            data: null,
            error: {
              code: "BILLING_NOT_CONFIGURED",
              message: "Professional self-service checkout is not configured.",
            },
          },
          503,
        );
      }
      const current = await prisma.billingSubscription.findUnique({ where: { organizationId } });
      if (
        current?.providerSubscriptionId &&
        current.status !== "CANCELED" &&
        current.status !== "INACTIVE"
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "SUBSCRIPTION_EXISTS",
              message: "This organization already has a paid plan.",
            },
          },
          409,
        );
      }
      const stripe = getStripeClient();
      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true, slug: true },
      });
      let customerId = current?.providerCustomerId ?? null;
      if (!customerId) {
        const customer = await stripe.customers.create(
          {
            name: organization.name,
            metadata: { organizationId, organizationSlug: organization.slug },
          },
          { idempotencyKey: `nomalog-customer-${organizationId}` },
        );
        customerId = customer.id;
        await prisma.billingSubscription.upsert({
          where: { organizationId },
          create: {
            organizationId,
            provider: "STRIPE",
            providerCustomerId: customerId,
            plan: "FREE_ASSESSMENT",
            status: "INACTIVE",
          },
          update: { provider: "STRIPE", providerCustomerId: customerId },
        });
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: offer.stripePriceId, quantity: 1 }],
        client_reference_id: organizationId,
        metadata: { organizationId, plan: "PROFESSIONAL" },
        subscription_data: { metadata: { organizationId, plan: "PROFESSIONAL" } },
        success_url: `${getAppBaseUrl()}/dashboard/billing?checkout=success`,
        cancel_url: `${getAppBaseUrl()}/dashboard/billing?checkout=cancelled`,
        allow_promotion_codes: true,
      });
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "BILLING_CHECKOUT_STARTED",
        metadata: { checkoutSessionId: session.id, plan: offer.id },
      });
      return c.json({ data: { url: session.url }, error: null }, 201);
    },
  );

  app.post(
    "/api/organizations/:organizationId/billing/portal",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const subscription = await prisma.billingSubscription.findUnique({
        where: { organizationId },
      });
      if (!subscription?.providerCustomerId || subscription.provider !== "STRIPE") {
        return c.json(
          {
            data: null,
            error: {
              code: "BILLING_CUSTOMER_NOT_FOUND",
              message: "No Stripe billing customer exists.",
            },
          },
          409,
        );
      }
      const portal = await getStripeClient().billingPortal.sessions.create({
        customer: subscription.providerCustomerId,
        return_url: `${getAppBaseUrl()}/dashboard/billing`,
      });
      return c.json({ data: { url: portal.url }, error: null });
    },
  );

  app.post(
    "/api/organizations/:organizationId/billing/cancel",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const subscription = await prisma.billingSubscription.findUnique({
        where: { organizationId },
      });
      if (!subscription?.providerSubscriptionId || subscription.provider !== "STRIPE") {
        return c.json(
          {
            data: null,
            error: {
              code: "SUBSCRIPTION_NOT_FOUND",
              message: "No active Stripe subscription exists.",
            },
          },
          409,
        );
      }
      const updated = await getStripeClient().subscriptions.update(
        subscription.providerSubscriptionId,
        { cancel_at_period_end: true },
      );
      await prisma.billingSubscription.update({
        where: { organizationId },
        data: { cancelAtPeriodEnd: updated.cancel_at_period_end },
      });
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "BILLING_CANCELLATION_SCHEDULED",
        metadata: { subscriptionId: updated.id, cancelAtPeriodEnd: updated.cancel_at_period_end },
      });
      return c.json({ data: { cancelAtPeriodEnd: updated.cancel_at_period_end }, error: null });
    },
  );

  app.post(
    "/api/organizations/:organizationId/billing/resume",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const subscription = await prisma.billingSubscription.findUnique({
        where: { organizationId },
      });
      if (!subscription?.providerSubscriptionId || subscription.provider !== "STRIPE") {
        return c.json(
          {
            data: null,
            error: { code: "SUBSCRIPTION_NOT_FOUND", message: "No Stripe subscription exists." },
          },
          409,
        );
      }
      const updated = await getStripeClient().subscriptions.update(
        subscription.providerSubscriptionId,
        { cancel_at_period_end: false },
      );
      await prisma.billingSubscription.update({
        where: { organizationId },
        data: { cancelAtPeriodEnd: updated.cancel_at_period_end },
      });
      return c.json({ data: { cancelAtPeriodEnd: updated.cancel_at_period_end }, error: null });
    },
  );

  app.post(
    "/api/organizations/:organizationId/billing/enterprise",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const body = await readJsonObject(c);
      const authorizedBillingAdministrators = new Set(
        (process.env["BILLING_ADMIN_USER_IDS"] ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      if (!authorizedBillingAdministrators.has(c.get("userId"))) {
        return c.json(
          {
            data: null,
            error: {
              code: "BILLING_ADMIN_NOT_AUTHORIZED",
              message:
                "Enterprise agreements can only be provisioned by an authorized billing administrator.",
            },
          },
          403,
        );
      }
      if (
        !body ||
        typeof body.agreementName !== "string" ||
        body.agreementName.trim().length < 3 ||
        body.agreementName.length > 200 ||
        typeof body.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(body.expiresAt)) ||
        Date.parse(body.expiresAt) <= Date.now()
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "A valid agreement name and future expiry date are required.",
            },
          },
          400,
        );
      }
      const allowed = [
        "maxRepositories",
        "assessmentsPerMonth",
        "analysisJobsPerMonth",
        "retentionDays",
        "maxTeamMembers",
      ] as const;
      const rawEntitlements = body.entitlements;
      if (
        rawEntitlements === null ||
        typeof rawEntitlements !== "object" ||
        Array.isArray(rawEntitlements)
      ) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "Agreed entitlement limits are required." },
          },
          400,
        );
      }
      const input = rawEntitlements as Record<string, unknown>;
      const enterprisePlan = getPlanCatalog().find((item) => item.id === "ENTERPRISE");
      if (!enterprisePlan) {
        throw new Error("Enterprise plan is not configured.");
      }
      const base = enterprisePlan.entitlements;
      const configured = { ...base };
      for (const key of allowed) {
        const value = input[key];
        if (value !== undefined) {
          if (
            typeof value !== "number" ||
            !Number.isSafeInteger(value) ||
            value < 0 ||
            value > 100000
          ) {
            return c.json(
              { data: null, error: { code: "VALIDATION_ERROR", message: `Invalid ${key} limit.` } },
              400,
            );
          }
          configured[key] = value;
        }
      }
      for (const key of [
        "continuousAnalysis",
        "policyEnforcement",
        "dataExport",
        "enterpriseIntegrations",
      ] as const) {
        const value = input[key];
        if (value !== undefined && typeof value !== "boolean") {
          return c.json(
            {
              data: null,
              error: { code: "VALIDATION_ERROR", message: `Invalid ${key} entitlement.` },
            },
            400,
          );
        }
        if (key === "enterpriseIntegrations" && value === true) {
          return c.json(
            {
              data: null,
              error: {
                code: "FEATURE_NOT_AVAILABLE",
                message:
                  "Enterprise integrations are not currently implemented and cannot be provisioned.",
              },
            },
            400,
          );
        }
        if (typeof value === "boolean") configured[key] = value;
      }
      const existingSubscription = await prisma.billingSubscription.findUnique({
        where: { organizationId },
      });
      if (
        existingSubscription?.provider === "STRIPE" &&
        existingSubscription.providerSubscriptionId &&
        !["CANCELED", "INACTIVE"].includes(existingSubscription.status)
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "EXISTING_SUBSCRIPTION",
              message:
                "Cancel the existing Stripe subscription before assigning a manual enterprise agreement.",
            },
          },
          409,
        );
      }
      const saved = await prisma.billingSubscription.upsert({
        where: { organizationId },
        create: {
          organizationId,
          plan: "ENTERPRISE",
          status: "ACTIVE",
          provider: "MANUAL",
          agreementName: body.agreementName.trim(),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(body.expiresAt),
          entitlements: configured,
        },
        update: {
          plan: "ENTERPRISE",
          status: "ACTIVE",
          provider: "MANUAL",
          providerSubscriptionId: null,
          providerPriceId: null,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(body.expiresAt),
          cancelAtPeriodEnd: false,
          agreementName: body.agreementName.trim(),
          entitlements: configured,
        },
      });
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "BILLING_ENTERPRISE_PROVISIONED",
        metadata: {
          subscriptionId: saved.id,
          agreementName: saved.agreementName,
          entitlements: configured,
        },
      });
      return c.json({
        data: { id: saved.id, plan: saved.plan, status: saved.status, entitlements: configured },
        error: null,
      });
    },
  );
}
