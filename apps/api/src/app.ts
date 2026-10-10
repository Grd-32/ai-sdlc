// // export { app };
// import { Hono } from "hono";
// import { cors } from "hono/cors";
// import { logger } from "hono/logger";
// import { checkDatabaseConnection } from "@ai-sdlc/db";
// import { getGitHubAppConfig, verifyWebhookSignature } from "@ai-sdlc/github";
// import { enqueueHealthCheck, getRedisConnection } from "./queue.js";
// import { ingestGitHubWebhookDelivery } from "./webhooks.js";
// import { registerAuthRoutes } from "./auth/github-oauth.js";
// import { registerOrganizationRoutes } from "./routes/organizations.js";
// import { registerGitHubInstallationRoutes } from "./routes/github-installations.js";
// import { registerAgentRoutes } from "./routes/agents.js";
// import { registerSettingsRoutes } from "./routes/settings.js";
// import type { AppEnv } from "./types.js";

// const app = new Hono<AppEnv>();

// app.use("*", logger());
// app.use(
//   "*",
//   cors({
//     origin: process.env["APP_URL"] ?? "http://localhost:3000",
//     credentials: true,
//   }),
// );

// /** Liveness probe — process is running */
// app.get("/health", (c) => {
//   return c.json({
//     data: { status: "ok", service: "api" },
//     error: null,
//   });
// });

// /** Readiness probe — dependencies available */
// app.get("/health/ready", async (c) => {
//   const dbOk = await checkDatabaseConnection();
//   let redisOk = false;

//   try {
//     const redis = getRedisConnection();
//     const pong = await redis.ping();
//     redisOk = pong.toUpperCase() === "PONG";
//   } catch {
//     redisOk = false;
//   }

//   const ready = dbOk && redisOk;

//   return c.json(
//     {
//       data: {
//         status: ready ? "ready" : "not_ready",
//         checks: {
//           database: dbOk ? "ok" : "fail",
//           redis: redisOk ? "ok" : "fail",
//         },
//       },
//       error: null,
//     },
//     ready ? 200 : 503,
//   );
// });

// /** GitHub App webhook endpoint (Phase 3) */
// app.post("/api/webhooks/github", async (c) => {
//   const payload = await c.req.text();
//   const signature = c.req.header("x-hub-signature-256") ?? "";
//   const event = c.req.header("x-github-event") ?? "unknown";
//   const delivery = c.req.header("x-github-delivery") ?? "unknown";
//   const webhookSecret = getGitHubAppConfig().webhookSecret ?? "";

//   if (!verifyWebhookSignature(payload, signature, webhookSecret)) {
//     return c.json(
//       {
//         data: null,
//         error: {
//           code: "INVALID_WEBHOOK_SIGNATURE",
//           message: "GitHub webhook signature verification failed",
//         },
//       },
//       401,
//     );
//   }

//   try {
//     const result = await ingestGitHubWebhookDelivery(payload, {
//       "x-github-event": event,
//       "x-github-delivery": delivery,
//     });

//     return c.json(
//       {
//         data: {
//           accepted: true,
//           event,
//           delivery,
//           eventId: result.eventId,
//           jobId: result.jobId,
//           status: result.status,
//         },
//         error: null,
//       },
//       202,
//     );
//   } catch (error) {
//     const message = error instanceof Error ? error.message : "Failed to ingest GitHub webhook";
//     console.error("[webhook] ingestion failed:", error);
//     return c.json(
//       {
//         data: null,
//         error: {
//           code: "GITHUB_WEBHOOK_INGESTION_FAILED",
//           message,
//         },
//       },
//       500,
//     );
//   }
// });

// /** Enqueue a test job to verify BullMQ pipeline (Phase 0) */
// app.post("/health/queue-test", async (c) => {
//   try {
//     const jobId = await enqueueHealthCheck();
//     return c.json({
//       data: { jobId, status: "enqueued" },
//       error: null,
//     });
//   } catch (err) {
//     const message = err instanceof Error ? err.message : "Failed to enqueue job";
//     return c.json(
//       {
//         data: null,
//         error: { code: "QUEUE_ERROR", message },
//       },
//       500,
//     );
//   }
// });

// // Phase 13: authentication + tenant-scoped dashboard API
// registerAuthRoutes(app);
// registerOrganizationRoutes(app);
// // Phase 14: real GitHub App installation-to-organization linking
// registerGitHubInstallationRoutes(app);
// // AI Agents aggregation + Settings-page read views
// registerAgentRoutes(app);
// registerSettingsRoutes(app);

// /** API root */
// app.get("/", (c) => {
//   return c.json({
//     data: {
//       name: "AI-SDLC Control Plane API",
//       version: "0.1.0",
//     },
//     error: null,
//   });
// });

// export { app };
import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { context, metrics, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { checkDatabaseConnection } from "@ai-sdlc/db";
import { getGitHubAppConfig, verifyWebhookSignature } from "@ai-sdlc/github";
import { enqueueHealthCheck, getRedisConnection } from "./queue.js";
import { GitHubWebhookDeliveryConflictError, ingestGitHubWebhookDelivery } from "./webhooks.js";
import { registerAuthRoutes } from "./auth/github-oauth.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";
import { registerGitHubInstallationRoutes } from "./routes/github-installations.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerPolicyManagementRoutes } from "./routes/policy-management.js";
import { registerOnboardingRoutes } from "./routes/onboarding.js";
import { registerIdentityProviderRoutes } from "./routes/identity-providers.js";
import { registerScimRoutes } from "./routes/scim.js";
import type { AppEnv } from "./types.js";

const app = new Hono<AppEnv>();
const tracer = trace.getTracer("ai-sdlc-api");
const meter = metrics.getMeter("ai-sdlc-api");
const requestCount = meter.createCounter("http.server.request.count", {
  description: "Number of API requests completed",
});
const apiSliRequestCount = meter.createCounter("api.sli.request.count", {
  description: "Number of non-probe API requests used for the availability SLI",
});
const requestDuration = meter.createHistogram("http.server.request.duration", {
  description: "Duration of completed API requests",
  unit: "s",
});
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

function getValidRequestId(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && requestIdPattern.test(candidate) ? candidate : undefined;
}

function getClientKey(
  forwardedHeader: string | undefined,
  realIpHeader: string | undefined,
  userAgent: string | undefined,
): string {
  const forwarded = forwardedHeader ?? "";
  const realIp = realIpHeader ?? "";
  const ip = forwarded.split(",")[0]?.trim() || realIp.trim() || "unknown";
  return `${ip}:${userAgent ?? "unknown"}`;
}

app.use("*", async (c, next) => {
  const requestId = getValidRequestId(c.req.header("x-request-id")) ?? randomUUID();
  const correlationId = getValidRequestId(c.req.header("x-correlation-id")) ?? requestId;
  const startedAt = Date.now();
  const parentContext = propagation.extract(context.active(), c.req.raw.headers);

  c.set("requestId", requestId);
  c.set("correlationId", correlationId);
  c.header("X-Request-ID", requestId);
  c.header("X-Correlation-ID", correlationId);

  await tracer.startActiveSpan(
    `${c.req.method} ${c.req.path}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": c.req.method,
        "url.path": c.req.path,
        "ai_sdlc.request_id": requestId,
        "ai_sdlc.correlation_id": correlationId,
      },
    },
    parentContext,
    async (span) => {
      try {
        await next();
        span.setAttribute("http.response.status_code", c.res.status);
        if (c.res.status >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        const spanContext = span.spanContext();
        const statusCode = c.res.status;
        const metricAttributes = {
          "http.request.method": c.req.method,
          "http.response.status_code": statusCode,
        };
        requestCount.add(1, metricAttributes);
        if (c.req.path !== "/health" && c.req.path !== "/health/ready") {
          apiSliRequestCount.add(1, { "http.response.status_code": statusCode });
        }
        requestDuration.record((Date.now() - startedAt) / 1000, metricAttributes);

        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "INFO",
            service: "api",
            message: "request completed",
            method: c.req.method,
            path: c.req.path,
            status: statusCode,
            durationMs: Date.now() - startedAt,
            requestId,
            correlationId,
            traceId:
              spanContext.traceId === "00000000000000000000000000000000"
                ? undefined
                : spanContext.traceId,
          }),
        );
        span.end();
      }
    },
  );
});
app.use(
  "*",
  cors({
    origin: process.env["APP_URL"] ?? "http://localhost:3000",
    credentials: true,
  }),
);
app.use("*", async (c, next) => {
  const requestMaxBytes = Number(process.env["API_REQUEST_MAX_BYTES"] ?? 1024 * 1024);
  const contentLengthHeader = c.req.header("content-length");
  const contentLength = Number(contentLengthHeader ?? "0");

  if (contentLengthHeader && Number.isFinite(contentLength) && contentLength > requestMaxBytes) {
    return c.json(
      {
        data: null,
        error: {
          code: "REQUEST_TOO_LARGE",
          message: `Request exceeds the ${requestMaxBytes} byte limit`,
        },
      },
      413,
    );
  }

  const windowMs = Number(process.env["API_RATE_LIMIT_WINDOW_MS"] ?? 60000);
  const rateLimitMax = Number(process.env["API_RATE_LIMIT_MAX"] ?? 120);
  const key = getClientKey(
    c.req.header("x-forwarded-for"),
    c.req.header("x-real-ip"),
    c.req.header("user-agent"),
  );
  const now = Date.now();
  const entry = rateLimitBuckets.get(key);

  if (windowMs > 0 && rateLimitMax > 0) {
    if (!entry || entry.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      if (entry.count >= rateLimitMax) {
        return c.json(
          {
            data: null,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: `Too many requests; limit is ${rateLimitMax} per ${windowMs}ms`,
            },
          },
          429,
        );
      }
      entry.count += 1;
    }
  }

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");

  await next();
});

/** Liveness probe — process is running */
app.get("/health", (c) => {
  return c.json({
    data: { status: "ok", service: "api" },
    error: null,
  });
});

/** Readiness probe — dependencies available */
app.get("/health/ready", async (c) => {
  const dbOk = await checkDatabaseConnection();
  let redisOk = false;

  try {
    const redis = getRedisConnection();
    const pong = await redis.ping();
    redisOk = pong.toUpperCase() === "PONG";
  } catch {
    redisOk = false;
  }

  const ready = dbOk && redisOk;

  return c.json(
    {
      data: {
        status: ready ? "ready" : "not_ready",
        checks: {
          database: dbOk ? "ok" : "fail",
          redis: redisOk ? "ok" : "fail",
        },
      },
      error: null,
    },
    ready ? 200 : 503,
  );
});

/** GitHub App webhook endpoint (Phase 3) */
app.post("/api/webhooks/github", async (c) => {
  const payload = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? "";
  const event = c.req.header("x-github-event") ?? "unknown";
  const delivery = c.req.header("x-github-delivery") ?? "unknown";
  const webhookSecret = getGitHubAppConfig().webhookSecret ?? "";

  if (!verifyWebhookSignature(payload, signature, webhookSecret)) {
    return c.json(
      {
        data: null,
        error: {
          code: "INVALID_WEBHOOK_SIGNATURE",
          message: "GitHub webhook signature verification failed",
        },
      },
      401,
    );
  }

  try {
    const result = await ingestGitHubWebhookDelivery(payload, {
      "x-github-event": event,
      "x-github-delivery": delivery,
    });

    return c.json(
      {
        data: {
          accepted: true,
          event,
          delivery,
          eventId: result.eventId,
          jobId: result.jobId,
          status: result.status,
          duplicate: result.duplicate,
        },
        error: null,
      },
      202,
    );
  } catch (error) {
    if (error instanceof GitHubWebhookDeliveryConflictError) {
      return c.json(
        {
          data: null,
          error: {
            code: "GITHUB_WEBHOOK_DELIVERY_CONFLICT",
            message: error.message,
          },
        },
        409,
      );
    }
    const message = error instanceof Error ? error.message : "Failed to ingest GitHub webhook";
    console.error("[webhook] ingestion failed:", error);
    return c.json(
      {
        data: null,
        error: {
          code: "GITHUB_WEBHOOK_INGESTION_FAILED",
          message,
        },
      },
      500,
    );
  }
});

/** Enqueue a test job to verify BullMQ pipeline (Phase 0) — disabled in production. */
app.post("/health/queue-test", async (c) => {
  if (process.env["NODE_ENV"] === "production") {
    return c.json({ data: null, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  }
  try {
    const jobId = await enqueueHealthCheck();
    return c.json({
      data: { jobId, status: "enqueued" },
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enqueue job";
    return c.json(
      {
        data: null,
        error: { code: "QUEUE_ERROR", message },
      },
      500,
    );
  }
});

// Phase 13: authentication + tenant-scoped dashboard API
registerAuthRoutes(app);
registerOrganizationRoutes(app);
// Phase 14: real GitHub App installation-to-organization linking
registerGitHubInstallationRoutes(app);
// AI Agents aggregation + Settings-page read views
registerAgentRoutes(app);
registerSettingsRoutes(app);
registerPolicyManagementRoutes(app);
registerOnboardingRoutes(app);
registerIdentityProviderRoutes(app);
registerScimRoutes(app);

/** API root */
app.get("/", (c) => {
  return c.json({
    data: {
      name: "AI-SDLC Control Plane API",
      version: "0.1.0",
    },
    error: null,
  });
});

export { app };
