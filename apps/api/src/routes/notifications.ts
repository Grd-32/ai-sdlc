import type { Hono } from "hono";
import {
  getNotificationCategory,
  NOTIFICATION_EMAIL_PREFERENCE_FIELDS,
  prisma,
  Prisma,
  recordAuditEvent,
} from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { readJsonObject } from "../request-body.js";
import type { AppEnv } from "../types.js";
import { enqueueNotificationDelivery } from "../queue.js";

const NOTIFICATION_CATEGORIES = new Set([
  "ALL",
  "SECURITY",
  "ASSESSMENTS",
  "GOVERNANCE",
  "INTEGRATIONS",
  "ACCOUNT",
]);
const NOTIFICATION_SEVERITIES = new Set(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
const NOTIFICATION_PREFERENCE_FIELDS = new Set([
  "emailEnabled",
  ...Object.values(NOTIFICATION_EMAIL_PREFERENCE_FIELDS),
]);

function categoryWhere(category: string): Prisma.NotificationWhereInput | undefined {
  switch (category) {
    case "SECURITY":
      return {
        OR: [{ type: { startsWith: "SECURITY_" } }, { type: { startsWith: "FINDING_" } }],
      };
    case "ASSESSMENTS":
      return { type: { startsWith: "ASSESSMENT_" } };
    case "GOVERNANCE":
      return {
        OR: [
          { type: { startsWith: "POLICY_" } },
          { type: { startsWith: "RISK_ACCEPTANCE_" } },
          { type: { startsWith: "REVIEW_" } },
          { type: { startsWith: "CHANGE_PASSPORT_" } },
        ],
      };
    case "INTEGRATIONS":
      return {
        OR: [{ type: { startsWith: "INTEGRATION_" } }, { type: { startsWith: "SOURCE_CONTROL_" } }],
      };
    case "ACCOUNT":
      return {
        OR: [
          { type: { startsWith: "ACCOUNT_" } },
          { type: { startsWith: "BILLING_" } },
          { type: { startsWith: "ORGANIZATION_INVITATION_" } },
        ],
      };
    default:
      return undefined;
  }
}

function notificationSeverity(type: string): string | null {
  return (
    ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].find((severity) => type.includes(severity)) ??
    null
  );
}

export function registerNotificationRoutes(app: Hono<AppEnv>): void {
  app.get(
    "/api/organizations/:organizationId/notifications",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const rawLimit = c.req.query("limit") ?? "50";
      const limit = Number(rawLimit);
      const category = (c.req.query("category") ?? "ALL").toUpperCase();
      const severity = (c.req.query("severity") ?? "ALL").toUpperCase();
      const unreadOnly = c.req.query("unreadOnly") ?? "false";
      const cursor = c.req.query("cursor");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "limit must be 1 to 100" } },
          400,
        );
      }
      if (!NOTIFICATION_CATEGORIES.has(category)) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "Unsupported notification category",
            },
          },
          400,
        );
      }
      if (!NOTIFICATION_SEVERITIES.has(severity)) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "Unsupported notification severity",
            },
          },
          400,
        );
      }
      if (unreadOnly !== "true" && unreadOnly !== "false") {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "unreadOnly must be true or false" },
          },
          400,
        );
      }
      if (cursor) {
        const cursorNotification = await prisma.notification.findFirst({
          where: { id: cursor, organizationId, userId },
          select: { id: true },
        });
        if (!cursorNotification) {
          return c.json(
            {
              data: null,
              error: { code: "VALIDATION_ERROR", message: "Invalid notification cursor" },
            },
            400,
          );
        }
      }

      const filters: Prisma.NotificationWhereInput[] = [
        categoryWhere(category),
        ...(severity !== "ALL" ? [{ type: { contains: severity } }] : []),
      ].filter((filter): filter is Prisma.NotificationWhereInput => filter !== undefined);
      const where = {
        organizationId,
        userId,
        ...(unreadOnly === "true" ? { readAt: null } : {}),
        ...(filters.length ? { AND: filters } : {}),
      };
      const [rows, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take: limit + 1,
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            href: true,
            readAt: true,
            emailStatus: true,
            createdAt: true,
          },
        }),
        prisma.notification.count({ where: { organizationId, userId, readAt: null } }),
      ]);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return c.json({
        data: {
          items: page.map((notification) => ({
            ...notification,
            category: getNotificationCategory(notification.type),
            severity: notificationSeverity(notification.type),
          })),
          nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
          unreadCount,
        },
        error: null,
      });
    },
  );

  app.get(
    "/api/organizations/:organizationId/notification-delivery-operations",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [statusGroups, attempts] = await Promise.all([
        prisma.notification.groupBy({
          by: ["emailStatus"],
          where: { organizationId, createdAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.notificationDeliveryAttempt.findMany({
          where: { notification: { organizationId }, attemptedAt: { gte: since } },
          orderBy: { attemptedAt: "desc" },
          take: 100,
          select: {
            id: true,
            attempt: true,
            status: true,
            attemptedAt: true,
            completedAt: true,
            latencyMs: true,
            errorCode: true,
            notification: { select: { id: true, type: true, createdAt: true } },
          },
        }),
      ]);
      return c.json({
        data: {
          periodStart: since.toISOString(),
          statusCounts: Object.fromEntries(
            statusGroups.map((group) => [group.emailStatus, group._count._all]),
          ),
          attempts,
        },
        error: null,
      });
    },
  );

  app.post(
    "/api/organizations/:organizationId/notification-delivery-operations/:notificationId/retry",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const notificationId = c.req.param("notificationId");
      if (!organizationId || !notificationId) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Notification not found" } },
          404,
        );
      }
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, organizationId },
        select: { id: true, emailStatus: true },
      });
      if (!notification) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Notification not found" } },
          404,
        );
      }
      if (notification.emailStatus !== "FAILED") {
        return c.json(
          {
            data: null,
            error: {
              code: "INVALID_STATE",
              message: "Only failed notification deliveries can be retried",
            },
          },
          409,
        );
      }

      const attempts = await prisma.notificationDeliveryAttempt.aggregate({
        where: { notificationId },
        _max: { attempt: true },
      });
      const attemptOffset = attempts._max.attempt ?? 0;
      const claimed = await prisma.notification.updateMany({
        where: { id: notificationId, organizationId, emailStatus: "FAILED" },
        data: { emailStatus: "PENDING" },
      });
      if (claimed.count !== 1) {
        return c.json(
          {
            data: null,
            error: { code: "INVALID_STATE", message: "Notification retry is already in progress" },
          },
          409,
        );
      }

      try {
        await enqueueNotificationDelivery(notificationId, attemptOffset);
      } catch (cause) {
        console.error("[notifications] manual retry enqueue failed", {
          notificationId,
          error: cause,
        });
        await prisma.notification.updateMany({
          where: { id: notificationId, organizationId, emailStatus: "PENDING" },
          data: { emailStatus: "FAILED" },
        });
        await prisma.notificationDeliveryAttempt.upsert({
          where: {
            notificationId_attempt: { notificationId, attempt: attemptOffset + 1 },
          },
          create: {
            notificationId,
            attempt: attemptOffset + 1,
            status: "FAILED",
            completedAt: new Date(),
            latencyMs: 0,
            errorCode: "QUEUE_ENQUEUE_FAILED",
          },
          update: {
            status: "FAILED",
            completedAt: new Date(),
            latencyMs: 0,
            errorCode: "QUEUE_ENQUEUE_FAILED",
          },
        });
        return c.json(
          {
            data: null,
            error: { code: "QUEUE_UNAVAILABLE", message: "Retry could not be queued" },
          },
          503,
        );
      }

      await recordAuditEvent({
        organizationId,
        actorId,
        eventType: "NOTIFICATION_DELIVERY_RETRIED",
        metadata: { notificationId, attemptOffset },
      });
      return c.json({ data: { queued: true }, error: null }, 202);
    },
  );

  app.post(
    "/api/organizations/:organizationId/notifications/read-all",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const result = await prisma.notification.updateMany({
        where: {
          organizationId: c.get("organizationId"),
          userId: c.get("userId"),
          readAt: null,
        },
        data: { readAt: new Date() },
      });
      return c.json({ data: { updated: result.count }, error: null });
    },
  );

  app.post(
    "/api/organizations/:organizationId/notifications/:notificationId/read",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const result = await prisma.notification.updateMany({
        where: {
          id: c.req.param("notificationId"),
          organizationId: c.get("organizationId"),
          userId: c.get("userId"),
        },
        data: { readAt: new Date() },
      });
      if (result.count !== 1) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Notification not found" } },
          404,
        );
      }
      return c.json({ data: { read: true }, error: null });
    },
  );

  app.get(
    "/api/organizations/:organizationId/notification-preferences",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const preference = await prisma.notificationPreference.findUnique({
        where: {
          organizationId_userId: {
            organizationId: c.get("organizationId"),
            userId: c.get("userId"),
          },
        },
        select: {
          emailEnabled: true,
          securityEmailEnabled: true,
          assessmentsEmailEnabled: true,
          governanceEmailEnabled: true,
          integrationsEmailEnabled: true,
          accountEmailEnabled: true,
        },
      });
      return c.json({
        data: preference ?? {
          emailEnabled: true,
          securityEmailEnabled: true,
          assessmentsEmailEnabled: true,
          governanceEmailEnabled: true,
          integrationsEmailEnabled: true,
          accountEmailEnabled: true,
        },
        error: null,
      });
    },
  );

  app.patch(
    "/api/organizations/:organizationId/notification-preferences",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const body = await readJsonObject(c);
      const fields = Object.keys(body ?? {});
      if (
        !body ||
        fields.length === 0 ||
        fields.some(
          (field) => !NOTIFICATION_PREFERENCE_FIELDS.has(field) || typeof body[field] !== "boolean",
        )
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "Provide one or more supported boolean notification preferences",
            },
          },
          400,
        );
      }

      const updates = {
        ...(typeof body["emailEnabled"] === "boolean"
          ? { emailEnabled: body["emailEnabled"] }
          : {}),
        ...(typeof body["securityEmailEnabled"] === "boolean"
          ? { securityEmailEnabled: body["securityEmailEnabled"] }
          : {}),
        ...(typeof body["assessmentsEmailEnabled"] === "boolean"
          ? { assessmentsEmailEnabled: body["assessmentsEmailEnabled"] }
          : {}),
        ...(typeof body["governanceEmailEnabled"] === "boolean"
          ? { governanceEmailEnabled: body["governanceEmailEnabled"] }
          : {}),
        ...(typeof body["integrationsEmailEnabled"] === "boolean"
          ? { integrationsEmailEnabled: body["integrationsEmailEnabled"] }
          : {}),
        ...(typeof body["accountEmailEnabled"] === "boolean"
          ? { accountEmailEnabled: body["accountEmailEnabled"] }
          : {}),
      };
      const preference = await prisma.notificationPreference.upsert({
        where: {
          organizationId_userId: {
            organizationId: c.get("organizationId"),
            userId: c.get("userId"),
          },
        },
        create: {
          organizationId: c.get("organizationId"),
          userId: c.get("userId"),
          ...updates,
        },
        update: updates,
        select: {
          emailEnabled: true,
          securityEmailEnabled: true,
          assessmentsEmailEnabled: true,
          governanceEmailEnabled: true,
          integrationsEmailEnabled: true,
          accountEmailEnabled: true,
        },
      });
      return c.json({ data: preference, error: null });
    },
  );
}
