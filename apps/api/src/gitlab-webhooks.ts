import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@ai-sdlc/db";
import { enqueuePullRequestAnalysis, enqueueSourceControlWebhookEvent } from "./queue.js";

type GitLabWebhookConnection = {
  id: string;
  organizationId: string;
  webhookSecretHash: string | null;
};

type GitLabRepository = {
  id: string;
  organizationId: string;
  sourceControlConnectionId: string | null;
};

type PullRequestRecord = {
  id: string;
  updatedAt: Date;
};

type GitLabWebhookEventRecord = {
  id: string;
  status: string;
  eventType: string;
  payloadHash: string;
};

type GitLabWebhookDb = {
  sourceControlConnection: {
    findFirst: (args: {
      where: { provider: string; active: boolean; webhookSecretHash: string };
      select: { id: true; organizationId: true; webhookSecretHash: true };
    }) => Promise<GitLabWebhookConnection | null>;
  };
  repository: {
    findFirst: (args: {
      where: {
        organizationId: string;
        provider: string;
        sourceControlConnectionId: string;
        externalId: string;
        enabled: boolean;
      };
      select: { id: true; organizationId: true; sourceControlConnectionId: true };
    }) => Promise<GitLabRepository | null>;
  };
  pullRequest: {
    findFirst: (args: {
      where: { repositoryId: string; provider: string; externalId: string };
      select: { id: true; updatedAt: true };
    }) => Promise<PullRequestRecord | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    updateMany: (args: {
      where: { id: string; updatedAt: { lte: Date } };
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  commit: {
    upsert: (args: {
      where: { repositoryId_sha: { repositoryId: string; sha: string } };
      update: { message: string; authorName: string | null; committedAt: Date | null };
      create: {
        organizationId: string;
        repositoryId: string;
        pullRequestId: string;
        sha: string;
        message: string;
        authorName: string | null;
        authorEmail: null;
        committedAt: Date | null;
      };
    }) => Promise<{ id: string }>;
  };
  gitHubWebhookEvent: {
    create: (args: { data: Record<string, unknown> }) => Promise<GitLabWebhookEventRecord>;
    findUnique: (args: {
      where: { provider_deliveryId: { provider: string; deliveryId: string } };
    }) => Promise<GitLabWebhookEventRecord | null>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<GitLabWebhookEventRecord>;
    updateMany: (args: {
      where: { id: string; status: string };
      data: { status: string; processedAt: Date | null };
    }) => Promise<{ count: number }>;
  };
};

const db = prisma as unknown as GitLabWebhookDb;
const ANALYZABLE_ACTIONS = new Set(["open", "update", "reopen"]);

export class GitLabWebhookAuthenticationError extends Error {
  constructor() {
    super("GitLab webhook authentication failed.");
    this.name = "GitLabWebhookAuthenticationError";
  }
}

export class GitLabWebhookDeliveryConflictError extends Error {
  constructor(deliveryId: string) {
    super(`GitLab webhook delivery ${deliveryId} was already received with a different payload.`);
    this.name = "GitLabWebhookDeliveryConflictError";
  }
}

export class GitLabWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitLabWebhookPayloadError";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new GitLabWebhookPayloadError("GitLab webhook body must be a JSON object.");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GitLabWebhookPayloadError) throw error;
    throw new GitLabWebhookPayloadError("GitLab webhook body must be valid JSON.");
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dateValue(value: unknown, field: string): Date {
  const parsed = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(parsed.getTime())) {
    throw new GitLabWebhookPayloadError(`GitLab merge request is missing a valid ${field}.`);
  }
  return parsed;
}

function safeWebhookPayload(
  eventType: string,
  event: Record<string, unknown>,
  projectId: string,
  projectPath: string | null,
): Record<string, unknown> {
  const attributes = objectValue(event["object_attributes"]);
  return {
    eventType,
    action: stringValue(attributes?.["action"]),
    project: { id: projectId, path: projectPath },
    mergeRequest: attributes
      ? {
          id: attributes["id"],
          iid: attributes["iid"],
          state: attributes["state"],
          title: attributes["title"],
          sourceBranch: attributes["source_branch"],
          targetBranch: attributes["target_branch"],
          updatedAt: attributes["updated_at"],
          mergedAt: attributes["merged_at"],
          lastCommit:
            objectValue(attributes["last_commit"])?.["id"] ?? attributes["last_commit_id"],
        }
      : null,
  };
}

async function persistMergeRequest(
  connection: GitLabWebhookConnection,
  event: Record<string, unknown>,
): Promise<{ repositoryId: string; pullRequestId: string; analyze: boolean; stale: boolean }> {
  const project = objectValue(event["project"]);
  const attributes = objectValue(event["object_attributes"]);
  if (!attributes) {
    throw new GitLabWebhookPayloadError("GitLab merge-request event is missing object attributes.");
  }
  const projectId = project?.["id"];
  const externalProjectId =
    typeof projectId === "string" || typeof projectId === "number" ? String(projectId) : null;
  const externalId = attributes["id"];
  const iid = attributes["iid"];
  const number = typeof iid === "number" ? iid : Number(iid);
  const validExternalId =
    (typeof externalId === "string" && externalId.length > 0) ||
    (typeof externalId === "number" && Number.isSafeInteger(externalId) && externalId > 0);
  if (!externalProjectId || !validExternalId || !Number.isSafeInteger(number) || number < 1) {
    throw new GitLabWebhookPayloadError(
      "GitLab merge-request event is missing its project or merge-request identifiers.",
    );
  }

  const repository = await db.repository.findFirst({
    where: {
      organizationId: connection.organizationId,
      provider: "GITLAB",
      sourceControlConnectionId: connection.id,
      externalId: externalProjectId,
      enabled: true,
    },
    select: { id: true, organizationId: true, sourceControlConnectionId: true },
  });
  if (
    !repository ||
    repository.organizationId !== connection.organizationId ||
    repository.sourceControlConnectionId !== connection.id
  ) {
    throw new GitLabWebhookPayloadError("GitLab project is not selected for this organization.");
  }

  const action = stringValue(attributes["action"]) ?? "";
  const state = stringValue(attributes["state"])?.toLowerCase();
  const headSha =
    stringValue(objectValue(attributes["last_commit"])?.["id"]) ??
    stringValue(attributes["last_commit_id"]);
  const updatedAt = dateValue(attributes["updated_at"], "updated_at");
  const createdAt = dateValue(attributes["created_at"], "created_at");
  const mergedAtValue = attributes["merged_at"];
  const mergedAt =
    typeof mergedAtValue === "string" && mergedAtValue.length > 0
      ? dateValue(mergedAtValue, "merged_at")
      : null;
  const author = objectValue(event["user"]);
  const data = {
    organizationId: connection.organizationId,
    repositoryId: repository.id,
    provider: "GITLAB",
    externalId: String(externalId),
    number,
    title: stringValue(attributes["title"]) ?? "Untitled merge request",
    state: state === "merged" ? "MERGED" : state === "closed" ? "CLOSED" : "OPEN",
    authorLogin: stringValue(author?.["username"]),
    sourceBranch: stringValue(attributes["source_branch"]),
    targetBranch: stringValue(attributes["target_branch"]),
    headSha,
    additions: 0,
    deletions: 0,
    changedFilesCount: 0,
    createdAt,
    updatedAt,
    mergedAt,
  };
  const existing = await db.pullRequest.findFirst({
    where: {
      repositoryId: repository.id,
      provider: "GITLAB",
      externalId: String(externalId),
    },
    select: { id: true, updatedAt: true },
  });

  let pullRequestId: string;
  let applied = true;
  if (existing) {
    pullRequestId = existing.id;
    const result = await db.pullRequest.updateMany({
      where: { id: existing.id, updatedAt: { lte: updatedAt } },
      data,
    });
    applied = result.count === 1;
  } else {
    try {
      const created = await db.pullRequest.create({ data });
      pullRequestId = created.id;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrent = await db.pullRequest.findFirst({
        where: {
          repositoryId: repository.id,
          provider: "GITLAB",
          externalId: String(externalId),
        },
        select: { id: true, updatedAt: true },
      });
      if (!concurrent) throw error;
      pullRequestId = concurrent.id;
      const result = await db.pullRequest.updateMany({
        where: { id: concurrent.id, updatedAt: { lte: updatedAt } },
        data,
      });
      applied = result.count === 1;
    }
  }

  if (!applied || !headSha) {
    return { repositoryId: repository.id, pullRequestId, analyze: false, stale: !applied };
  }

  await db.commit.upsert({
    where: { repositoryId_sha: { repositoryId: repository.id, sha: headSha } },
    update: {
      message: data.title,
      authorName: data.authorLogin,
      committedAt: updatedAt,
    },
    create: {
      organizationId: connection.organizationId,
      repositoryId: repository.id,
      pullRequestId,
      sha: headSha,
      message: data.title,
      authorName: data.authorLogin,
      authorEmail: null,
      committedAt: updatedAt,
    },
  });

  return {
    repositoryId: repository.id,
    pullRequestId,
    analyze: ANALYZABLE_ACTIONS.has(action) && data.state === "OPEN",
    stale: false,
  };
}

export async function ingestGitLabWebhookDelivery(
  payload: string,
  headers: Record<string, string | undefined>,
): Promise<{
  eventId?: string;
  jobId?: string;
  status: string;
  duplicate: boolean;
  ignored?: boolean;
}> {
  const token = headers["x-gitlab-token"] ?? "";
  if (!token || token.length > 256) throw new GitLabWebhookAuthenticationError();
  const secretHash = createHash("sha256").update(token, "utf8").digest("hex");
  const connection = await db.sourceControlConnection.findFirst({
    where: { provider: "GITLAB", active: true, webhookSecretHash: secretHash },
    select: { id: true, organizationId: true, webhookSecretHash: true },
  });
  const storedHash =
    connection?.webhookSecretHash && /^[a-f0-9]{64}$/i.test(connection.webhookSecretHash)
      ? Buffer.from(connection.webhookSecretHash, "hex")
      : null;
  const receivedHash = Buffer.from(secretHash, "hex");
  if (
    !connection ||
    !storedHash ||
    storedHash.length !== receivedHash.length ||
    !timingSafeEqual(storedHash, receivedHash)
  ) {
    throw new GitLabWebhookAuthenticationError();
  }

  const eventType = headers["x-gitlab-event"] ?? "";
  const eventUuid = headers["x-gitlab-event-uuid"] ?? "";
  if (!eventType) throw new GitLabWebhookPayloadError("GitLab event type header is required.");
  if (!eventUuid || eventUuid.length > 128) {
    throw new GitLabWebhookPayloadError("GitLab event UUID header is required.");
  }
  if (eventType !== "Merge Request Hook") {
    return { status: "IGNORED_UNSUPPORTED_EVENT", duplicate: false, ignored: true };
  }

  const event = parsePayload(payload);
  const project = objectValue(event["project"]);
  const projectIdValue = project?.["id"];
  const projectId =
    typeof projectIdValue === "string" || typeof projectIdValue === "number"
      ? String(projectIdValue)
      : null;
  if (!projectId) {
    throw new GitLabWebhookPayloadError("GitLab merge-request event is missing its project ID.");
  }
  const repository = await db.repository.findFirst({
    where: {
      organizationId: connection.organizationId,
      provider: "GITLAB",
      sourceControlConnectionId: connection.id,
      externalId: projectId,
      enabled: true,
    },
    select: { id: true, organizationId: true, sourceControlConnectionId: true },
  });
  if (!repository) {
    return { status: "IGNORED_UNSELECTED_PROJECT", duplicate: false, ignored: true };
  }

  const deliveryId = `${connection.id}:${eventUuid}`;
  const payloadHash = createHash("sha256").update(payload, "utf8").digest("hex");
  let delivery: GitLabWebhookEventRecord;
  try {
    delivery = await db.gitHubWebhookEvent.create({
      data: {
        provider: "GITLAB",
        eventType,
        deliveryId,
        payloadHash,
        payload: safeWebhookPayload(
          eventType,
          event,
          projectId,
          stringValue(project?.["path_with_namespace"]),
        ),
        organizationId: connection.organizationId,
        repositoryId: repository.id,
        status: "RECEIVED",
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await db.gitHubWebhookEvent.findUnique({
      where: { provider_deliveryId: { provider: "GITLAB", deliveryId } },
    });
    if (!existing) throw error;
    if (existing.eventType !== eventType || existing.payloadHash !== payloadHash) {
      throw new GitLabWebhookDeliveryConflictError(eventUuid);
    }
    if (existing.status !== "FAILED") {
      return { eventId: existing.id, status: existing.status, duplicate: true };
    }
    const claim = await db.gitHubWebhookEvent.updateMany({
      where: { id: existing.id, status: "FAILED" },
      data: { status: "RECEIVED", processedAt: null },
    });
    if (claim.count !== 1) {
      const latest = await db.gitHubWebhookEvent.findUnique({
        where: { provider_deliveryId: { provider: "GITLAB", deliveryId } },
      });
      if (!latest) throw new Error(`GitLab delivery ${eventUuid} disappeared during retry claim.`);
      return { eventId: latest.id, status: latest.status, duplicate: true };
    }
    delivery = { ...existing, status: "RECEIVED" };
  }

  try {
    const persisted = await persistMergeRequest(connection, event);
    if (persisted.analyze) {
      await enqueuePullRequestAnalysis({
        organizationId: connection.organizationId,
        repositoryId: persisted.repositoryId,
        pullRequestId: persisted.pullRequestId,
      });
    }
    if (persisted.stale) {
      await db.gitHubWebhookEvent.update({
        where: { id: delivery.id },
        data: { status: "STALE", processedAt: new Date() },
      });
      return {
        eventId: delivery.id,
        status: "STALE",
        duplicate: false,
      };
    }
    await db.gitHubWebhookEvent.update({
      where: { id: delivery.id },
      data: { status: "QUEUED" },
    });
    const jobId = await enqueueSourceControlWebhookEvent({
      provider: "GITLAB",
      eventType,
      deliveryId,
      payloadHash,
      organizationId: connection.organizationId,
      repositoryId: persisted.repositoryId,
    });
    return {
      eventId: delivery.id,
      jobId,
      status: "QUEUED",
      duplicate: false,
    };
  } catch (error) {
    try {
      await db.gitHubWebhookEvent.update({
        where: { id: delivery.id },
        data: { status: "FAILED", processedAt: new Date() },
      });
    } catch (statusError) {
      throw new AggregateError(
        [error, statusError],
        `GitLab delivery ${eventUuid} failed and its failure status could not be persisted.`,
      );
    }
    throw error;
  }
}
