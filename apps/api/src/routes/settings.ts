/**
 * Settings-page read views. Gated above plain VIEWER since both surfaces
 * expose security-relevant information:
 * - Installations: ADMIN+ — connecting/viewing GitHub App installations is
 *   an administrative concern (matches the ADMIN gate already used on the
 *   installation setup-URL callback itself).
 * - Audit events: AUDITOR+ — README's own role list names AUDITOR
 *   specifically for this purpose; gating here at exactly that role (rather
 *   than a higher one) is the RBAC model actually being used as intended.
 */

import type { Hono } from "hono";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export function registerSettingsRoutes(app: Hono<AppEnv>): void {
  app.patch(
    "/api/organizations/:organizationId/settings/policy-approval-quorum",
    requireAuth,
    requireOrganizationRole("OWNER"),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      const policyApprovalQuorum =
        body && typeof body === "object" && "policyApprovalQuorum" in body
          ? body.policyApprovalQuorum
          : undefined;
      if (
        typeof policyApprovalQuorum !== "number" ||
        !Number.isInteger(policyApprovalQuorum) ||
        policyApprovalQuorum < 1 ||
        policyApprovalQuorum > 5
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "INVALID_POLICY_APPROVAL_QUORUM",
              message: "policyApprovalQuorum must be an integer between 1 and 5",
            },
          },
          400,
        );
      }

      const organizationId = c.get("organizationId");
      const organization = await prisma.organization.update({
        where: { id: organizationId },
        data: { policyApprovalQuorum },
        select: { policyApprovalQuorum: true },
      });
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "ORGANIZATION_POLICY_APPROVAL_QUORUM_UPDATED",
        metadata: { policyApprovalQuorum },
      });
      return c.json({ data: organization, error: null });
    },
  );

  app.get(
    "/api/organizations/:organizationId/settings/retention",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organization = await prisma.organization.findUnique({
        where: { id: c.get("organizationId") },
        select: { webhookRetentionDays: true },
      });

      if (!organization) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Organization not found" } },
          404,
        );
      }

      return c.json({ data: organization, error: null });
    },
  );

  app.patch(
    "/api/organizations/:organizationId/settings/retention",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      if (!body || typeof body !== "object" || !("webhookRetentionDays" in body)) {
        return c.json(
          {
            data: null,
            error: {
              code: "INVALID_RETENTION_POLICY",
              message: "webhookRetentionDays is required",
            },
          },
          400,
        );
      }

      const webhookRetentionDays = body.webhookRetentionDays;
      if (
        webhookRetentionDays !== null &&
        (typeof webhookRetentionDays !== "number" ||
          !Number.isInteger(webhookRetentionDays) ||
          webhookRetentionDays < 1 ||
          webhookRetentionDays > 3650)
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "INVALID_RETENTION_POLICY",
              message: "webhookRetentionDays must be null or an integer between 1 and 3650",
            },
          },
          400,
        );
      }

      const organizationId = c.get("organizationId");
      const organization = await prisma.organization.update({
        where: { id: organizationId },
        data: { webhookRetentionDays },
        select: { webhookRetentionDays: true },
      });

      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "ORGANIZATION_RETENTION_UPDATED",
        metadata: { webhookRetentionDays },
      });

      return c.json({ data: organization, error: null });
    },
  );

  app.get(
    "/api/organizations/:organizationId/installations",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");

      const installations = await prisma.gitHubInstallation.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          githubInstallationId: true,
          accountLogin: true,
          accountType: true,
          active: true,
          createdAt: true,
        },
      });

      return c.json({ data: installations, error: null });
    },
  );

  app.delete(
    "/api/organizations/:organizationId/installations/:installationId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const installationId = c.req.param("installationId");
      const installation = await prisma.gitHubInstallation.findFirst({
        where: { id: installationId, organizationId },
        select: { id: true, active: true, githubInstallationId: true },
      });

      if (!installation) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "GitHub installation not found" } },
          404,
        );
      }
      if (!installation.active) {
        return c.json({ data: { disconnected: true }, error: null });
      }

      await prisma.$transaction(async (tx) => {
        await tx.gitHubInstallation.updateMany({
          where: { id: installation.id, organizationId, active: true },
          data: { active: false },
        });
        const repositories = await tx.repository.findMany({
          where: { githubInstallationId: installation.id, organizationId },
          select: { id: true },
        });
        const repositoryIds = repositories.map(({ id }) => id);
        await tx.repository.updateMany({
          where: { githubInstallationId: installation.id, organizationId },
          data: { enabled: false },
        });
        if (repositoryIds.length > 0) {
          await tx.assessment.updateMany({
            where: {
              organizationId,
              status: { in: ["CREATED", "AUTHORIZATION_PENDING", "QUEUED", "RUNNING"] },
              repositories: { some: { repositoryId: { in: repositoryIds } } },
            },
            data: {
              status: "CANCELLED",
              cancelledAt: new Date(),
              errorCode: "GITHUB_INSTALLATION_DISCONNECTED",
              errorMessage: "The GitHub installation was disconnected by an organization admin.",
            },
          });
        }
      });

      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "GITHUB_INSTALLATION_DISCONNECTED",
        metadata: { githubInstallationId: installation.githubInstallationId },
      });

      return c.json({
        data: { disconnected: true, githubAppRemovalRequired: true },
        error: null,
      });
    },
  );

  app.get(
    "/api/organizations/:organizationId/settings/data-deletion",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const request = await prisma.organizationDeletionRequest.findFirst({
        where: {
          organizationId: c.get("organizationId"),
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true },
      });
      return c.json({ data: request, error: null });
    },
  );

  app.post(
    "/api/operator/organization-deletion-requests/:requestId/approve",
    requireAuth,
    async (c) => {
      const operators = new Set(
        (process.env["DATA_DELETION_OPERATOR_USER_IDS"] ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      const userId = c.get("userId");
      if (operators.size === 0) {
        return c.json(
          {
            data: null,
            error: {
              code: "DELETION_OPERATOR_NOT_CONFIGURED",
              message: "Organization deletion operators are not configured.",
            },
          },
          503,
        );
      }
      if (!operators.has(userId)) {
        return c.json(
          {
            data: null,
            error: {
              code: "DELETION_OPERATOR_REQUIRED",
              message: "Only an authorized deletion operator can approve this request.",
            },
          },
          403,
        );
      }
      const body: unknown = await c.req.json().catch(() => null);
      const confirmOrganizationSlug =
        typeof body === "object" &&
        body !== null &&
        "confirmOrganizationSlug" in body
          ? body.confirmOrganizationSlug
          : null;
      const externalCleanupConfirmed =
        typeof body === "object" &&
        body !== null &&
        "externalCleanupConfirmed" in body
          ? body.externalCleanupConfirmed
          : false;
      const externalCleanupSummary =
        typeof body === "object" &&
        body !== null &&
        "externalCleanupSummary" in body &&
        typeof body.externalCleanupSummary === "string"
          ? body.externalCleanupSummary.trim()
          : "";
      const request = await prisma.organizationDeletionRequest.findUnique({
        where: { id: c.req.param("requestId") },
        select: {
          id: true,
          organizationId: true,
          organizationSlug: true,
          status: true,
        },
      });
      if (!request || !request.organizationId) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Deletion request not found." } },
          404,
        );
      }
      const organizationId = request.organizationId;
      if (
        confirmOrganizationSlug !== request.organizationSlug ||
        externalCleanupConfirmed !== true ||
        externalCleanupSummary.length < 20
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "CONFIRMATION_REQUIRED",
              message:
                "Confirm the organization slug, document completed billing/provider cleanup, and attest it before erasure.",
            },
          },
          400,
        );
      }
      if (request.status !== "PENDING") {
        return c.json(
          { data: null, error: { code: "DELETION_REQUEST_NOT_PENDING", message: "Request is not pending." } },
          409,
        );
      }
      const subscription = await prisma.billingSubscription.findUnique({
        where: { organizationId },
        select: { status: true },
      });
      if (["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscription?.status ?? "")) {
        return c.json(
          {
            data: null,
            error: {
              code: "SUBSCRIPTION_REQUIRES_CANCELLATION",
              message: "Cancel or resolve the organization subscription before erasure.",
            },
          },
          409,
        );
      }
      await recordAuditEvent({
        organizationId,
        actorId: userId,
        eventType: "ORGANIZATION_DATA_DELETION_REQUESTED",
        metadata: {
          requestId: request.id,
          organizationSlug: request.organizationSlug,
          operatorApproved: true,
          externalCleanupConfirmed: true,
          externalCleanupSummary,
        },
      });
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.organizationDeletionRequest.updateMany({
          where: { id: request.id, status: "PENDING", organizationId },
          data: {
            status: "IN_PROGRESS",
            approvedById: userId,
            approvedAt: new Date(),
          },
        });
        if (claimed.count !== 1) {
          throw new Error("Deletion request is no longer pending.");
        }
        await tx.organization.delete({ where: { id: organizationId } });
        await tx.organizationDeletionRequest.update({
          where: { id: request.id },
          data: { status: "COMPLETED", resolvedAt: new Date(), failureReason: null },
        });
      });
      return c.json(
        {
          data: {
            requestId: request.id,
            organizationSlug: request.organizationSlug,
            status: "COMPLETED",
          },
          error: null,
        },
        200,
      );
    },
  );

  app.post(
    "/api/organizations/:organizationId/settings/data-deletion",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      if (c.get("organizationRole") !== "OWNER") {
        return c.json(
          {
            data: null,
            error: {
              code: "OWNER_REQUIRED",
              message: "Only the organization owner may request deletion",
            },
          },
          403,
        );
      }

      const body: unknown = await c.req.json().catch(() => null);
      const confirmation =
        typeof body === "object" && body !== null && "confirmOrganizationSlug" in body
          ? body.confirmOrganizationSlug
          : null;
      const organizationId = c.get("organizationId");
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true, billingSubscription: { select: { status: true } } },
      });
      if (!organization) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Organization not found" } },
          404,
        );
      }
      if (confirmation !== organization.slug) {
        return c.json(
          {
            data: null,
            error: {
              code: "CONFIRMATION_REQUIRED",
              message: "Enter the organization slug to confirm",
            },
          },
          400,
        );
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId})) IS NULL AS locked`;
        const activeRequest = await tx.organizationDeletionRequest.findFirst({
          where: { organizationId, status: { in: ["PENDING", "IN_PROGRESS"] } },
          select: { id: true, status: true, createdAt: true },
        });
        if (activeRequest) return { request: activeRequest, created: false };

        const request = await tx.organizationDeletionRequest.create({
          data: {
            organizationId,
            organizationSlug: organization.slug,
            requestedById: c.get("userId"),
          },
          select: { id: true, status: true, createdAt: true },
        });
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorId: c.get("userId"),
            eventType: "ORGANIZATION_DATA_DELETION_REQUESTED",
          },
        });
        return { request, created: true };
      });
      const subscriptionNeedsResolution = ["ACTIVE", "TRIALING", "PAST_DUE"].includes(
        organization.billingSubscription?.status ?? "",
      );

      return c.json(
        {
          data: {
            status: result.request.status,
            createdAt: result.request.createdAt,
            alreadyPending: !result.created,
            subscriptionNeedsResolution,
            message:
              "The request is recorded for operator review; it does not delete data immediately. Data is retained until the request is verified and processed.",
          },
          error: null,
        },
        202,
      );
    },
  );

  app.get(
    "/api/organizations/:organizationId/audit-events",
    requireAuth,
    requireOrganizationRole("AUDITOR"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);

      const events = await prisma.auditEvent.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { actor: { select: { name: true, username: true, email: true } } },
      });

      return c.json({
        data: events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          actor: event.actor
            ? (event.actor.name ?? event.actor.username ?? event.actor.email)
            : null,
          metadata: event.metadata,
          createdAt: event.createdAt,
        })),
        error: null,
      });
    },
  );
}
