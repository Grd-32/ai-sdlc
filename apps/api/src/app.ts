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
import { logger } from "hono/logger";
import { checkDatabaseConnection } from "@ai-sdlc/db";
import { getGitHubAppConfig, verifyWebhookSignature } from "@ai-sdlc/github";
import { enqueueHealthCheck, getRedisConnection } from "./queue.js";
import { ingestGitHubWebhookDelivery } from "./webhooks.js";
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

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env["APP_URL"] ?? "http://localhost:3000",
    credentials: true,
  }),
);

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
        },
        error: null,
      },
      202,
    );
  } catch (error) {
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