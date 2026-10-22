import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@ai-sdlc/db";
import { decryptSourceControlSecret } from "@ai-sdlc/source-control";
import { enqueuePullRequestAnalysis, enqueueSourceControlWebhookEvent } from "./queue.js";

type Connection = {
  id: string;
  organizationId: string;
  webhookSecretCiphertext: string | null;
};

type Repository = {
  id: string;
  organizationId: string;
  sourceControlConnectionId: string | null;
};

type WebhookEvent = {
  id: string;
  status: string;
  eventType: string;
  payloadHash: string;
};

type AzureDevOpsWebhookDb = {
  sourceControlConnection: {
    findFirst: (args: {
      where: { id: string; provider: string; active: boolean };
      select: { id: true; organizationId: true; webhookSecretCiphertext: true };
    }) => Promise<Connection | null>;
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
    }) => Promise<Repository | null>;
  };
  pullRequest: {
    findFirst: (args: {
      where: { repositoryId: string; provider: string; externalId: string };
      select: { id: true; updatedAt: true };
    }) => Promise<{ id: string; updatedAt: Date } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    updateMany: (args: {
      where: { id: string; updatedAt: { lte: Date } };
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  gitHubWebhookEvent: {
    create: (args: { data: Record<string, unknown> }) => Promise<WebhookEvent>;
    findUnique: (args: {
      where: { provider_deliveryId: { provider: string; deliveryId: string } };
    }) => Promise<WebhookEvent | null>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<WebhookEvent>;
    updateMany: (args: {
      where: { id: string; status: string };
      data: { status: string; processedAt: Date | null };
    }) => Promise<{ count: number }>;
  };
};

const db = prisma as unknown as AzureDevOpsWebhookDb;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const SUPPORTED_EVENTS = new Set(["git.pullrequest.created", "git.pullrequest.updated"]);
const BASIC_AUTH_USERNAME = "ai-sdlc";

export class AzureDevOpsWebhookAuthenticationError extends Error {
  constructor() {
    super("Azure DevOps webhook authentication failed.");
    this.name = "AzureDevOpsWebhookAuthenticationError";
  }
}

export class AzureDevOpsWebhookDeliveryConflictError extends Error {
  constructor(deliveryId: string) {
    super(
      `Azure DevOps webhook delivery ${deliveryId} was already received with a different payload.`,
    );
    this.name = "AzureDevOpsWebhookDeliveryConflictError";
  }
}

export class AzureDevOpsWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AzureDevOpsWebhookPayloadError";
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function parsePayload(payload: string): Record<string, unknown> {
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new AzureDevOpsWebhookPayloadError("Azure DevOps webhook body exceeds the 1 MiB limit.");
  }
  try {
    const value: unknown = JSON.parse(payload);
    const record = objectValue(value);
    if (!record)
      throw new AzureDevOpsWebhookPayloadError("Azure DevOps webhook body must be a JSON object.");
    return record;
  } catch (error) {
    if (error instanceof AzureDevOpsWebhookPayloadError) throw error;
    throw new AzureDevOpsWebhookPayloadError("Azure DevOps webhook body must be valid JSON.");
  }
}

function dateValue(value: unknown): Date {
  const date = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(date.getTime())) {
    throw new AzureDevOpsWebhookPayloadError(
      "Azure DevOps pull-request event is missing a valid createdDate.",
    );
  }
  return date;
}

function credentialsMatch(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("Basic ")) return false;
  const encoded = header.slice("Basic ".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64") !== encoded) return false;
  const separator = decoded.indexOf(":");
  if (separator < 0 || decoded.slice(0, separator) !== BASIC_AUTH_USERNAME) return false;
  const supplied = Buffer.from(decoded.slice(separator + 1), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function sanitizedPayload(
  eventType: string,
  eventId: string,
  resource: Record<string, unknown>,
  repositoryId: string,
): Record<string, unknown> {
  const commit = objectValue(resource["lastMergeSourceCommit"]);
  return {
    eventType,
    eventId,
    repositoryId,
    pullRequestId: resource["pullRequestId"],
    status: resource["status"],
    sourceRefName: resource["sourceRefName"],
    targetRefName: resource["targetRefName"],
    headSha: commit?.["commitId"] ?? null,
  };
}

async function persistPullRequest(
  connection: Connection,
  event: Record<string, unknown>,
): Promise<{ repositoryId: string; pullRequestId: string; analyze: boolean; stale: boolean }> {
  const resource = objectValue(event["resource"]);
  const remoteRepository = objectValue(resource?.["repository"]);
  const remoteProject = objectValue(remoteRepository?.["project"]);
  const remoteRepositoryId = stringValue(remoteRepository?.["id"]);
  const projectId = stringValue(remoteProject?.["id"]);
  const pullRequestNumberValue = resource?.["pullRequestId"];
  const number =
    typeof pullRequestNumberValue === "number"
      ? pullRequestNumberValue
      : Number(pullRequestNumberValue);
  if (
    !resource ||
    !remoteRepositoryId ||
    !projectId ||
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    throw new AzureDevOpsWebhookPayloadError(
      "Azure DevOps pull-request event is missing repository, project, or pull-request identifiers.",
    );
  }

  const repository = await db.repository.findFirst({
    where: {
      organizationId: connection.organizationId,
      provider: "AZURE_DEVOPS",
      sourceControlConnectionId: connection.id,
      externalId: remoteRepositoryId,
      enabled: true,
    },
    select: { id: true, organizationId: true, sourceControlConnectionId: true },
  });
  if (
    !repository ||
    repository.organizationId !== connection.organizationId ||
    repository.sourceControlConnectionId !== connection.id
  ) {
    throw new AzureDevOpsWebhookPayloadError(
      "Azure DevOps repository is not selected for this organization.",
    );
  }

  const status = stringValue(resource["status"])?.toLowerCase();
  if (!status || !["active", "completed", "abandoned"].includes(status)) {
    throw new AzureDevOpsWebhookPayloadError(
      "Azure DevOps pull request has an unsupported status.",
    );
  }
  const createdAt = dateValue(resource["creationDate"]);
  const updatedAt = dateValue(event["createdDate"]);
  const headSha = stringValue(objectValue(resource["lastMergeSourceCommit"])?.["commitId"]);
  const author = objectValue(resource["createdBy"]);
  const authorLogin = stringValue(author?.["uniqueName"]) ?? stringValue(author?.["displayName"]);
  const externalId = String(number);
  const title = stringValue(resource["title"]) ?? "Untitled pull request";
  const mergedAt =
    status === "completed" && typeof resource["closedDate"] === "string"
      ? dateValue(resource["closedDate"])
      : null;
  const data = {
    organizationId: connection.organizationId,
    repositoryId: repository.id,
    provider: "AZURE_DEVOPS",
    externalId,
    number,
    title,
    state: status === "active" ? "OPEN" : status === "completed" ? "MERGED" : "CLOSED",
    authorLogin,
    sourceBranch: stringValue(resource["sourceRefName"])?.replace(/^refs\/heads\//, "") ?? null,
    targetBranch: stringValue(resource["targetRefName"])?.replace(/^refs\/heads\//, "") ?? null,
    headSha,
    additions: 0,
    deletions: 0,
    changedFilesCount: 0,
    createdAt,
    updatedAt,
    mergedAt,
  };
  let existing = await db.pullRequest.findFirst({
    where: { repositoryId: repository.id, provider: "AZURE_DEVOPS", externalId },
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
      existing = await db.pullRequest.findFirst({
        where: { repositoryId: repository.id, provider: "AZURE_DEVOPS", externalId },
        select: { id: true, updatedAt: true },
      });
      if (!existing) throw error;
      pullRequestId = existing.id;
      const result = await db.pullRequest.updateMany({
        where: { id: existing.id, updatedAt: { lte: updatedAt } },
        data,
      });
      applied = result.count === 1;
    }
  }
  if (!applied || !headSha) {
    return { repositoryId: repository.id, pullRequestId, analyze: false, stale: !applied };
  }

  return {
    repositoryId: repository.id,
    pullRequestId,
    analyze: status === "active",
    stale: false,
  };
}

export async function ingestAzureDevOpsWebhookDelivery(
  connectionId: string,
  payload: string,
  authorization: string | undefined,
): Promise<{
  eventId?: string;
  jobId?: string;
  status: string;
  duplicate: boolean;
  ignored?: boolean;
}> {
  if (!connectionId || connectionId.length > 128) throw new AzureDevOpsWebhookAuthenticationError();
  const connection = await db.sourceControlConnection.findFirst({
    where: { id: connectionId, provider: "AZURE_DEVOPS", active: true },
    select: { id: true, organizationId: true, webhookSecretCiphertext: true },
  });
  let secret: string | null = null;
  if (connection?.webhookSecretCiphertext) {
    try {
      secret = decryptSourceControlSecret(connection.webhookSecretCiphertext);
    } catch {
      secret = null;
    }
  }
  if (!connection || !secret || !credentialsMatch(authorization, secret)) {
    throw new AzureDevOpsWebhookAuthenticationError();
  }

  const event = parsePayload(payload);
  const eventType = stringValue(event["eventType"]) ?? "";
  if (eventType === "servicehook.test") {
    return { status: "TEST_ACKNOWLEDGED", duplicate: false, ignored: true };
  }
  if (!SUPPORTED_EVENTS.has(eventType)) {
    return { status: "IGNORED_UNSUPPORTED_EVENT", duplicate: false, ignored: true };
  }
  const eventId = stringValue(event["id"]);
  const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!eventId || !eventIdPattern.test(eventId)) {
    throw new AzureDevOpsWebhookPayloadError("Azure DevOps webhook event ID must be a UUID.");
  }
  const resource = objectValue(event["resource"]);
  const remoteRepository = objectValue(resource?.["repository"]);
  const remoteRepositoryId = stringValue(remoteRepository?.["id"]);
  if (!resource || !remoteRepositoryId) {
    throw new AzureDevOpsWebhookPayloadError(
      "Azure DevOps pull-request event is missing repository data.",
    );
  }
  const repository = await db.repository.findFirst({
    where: {
      organizationId: connection.organizationId,
      provider: "AZURE_DEVOPS",
      sourceControlConnectionId: connection.id,
      externalId: remoteRepositoryId,
      enabled: true,
    },
    select: { id: true, organizationId: true, sourceControlConnectionId: true },
  });
  if (!repository) {
    return { status: "IGNORED_UNSELECTED_REPOSITORY", duplicate: false, ignored: true };
  }
  const deliveryId = `${connection.id}:${eventId}`;
  const payloadHash = createHash("sha256").update(payload, "utf8").digest("hex");
  let delivery: WebhookEvent;
  try {
    delivery = await db.gitHubWebhookEvent.create({
      data: {
        provider: "AZURE_DEVOPS",
        eventType,
        deliveryId,
        payloadHash,
        payload: sanitizedPayload(eventType, eventId, resource, remoteRepositoryId),
        organizationId: connection.organizationId,
        repositoryId: repository.id,
        status: "RECEIVED",
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await db.gitHubWebhookEvent.findUnique({
      where: { provider_deliveryId: { provider: "AZURE_DEVOPS", deliveryId } },
    });
    if (!existing) throw error;
    if (existing.eventType !== eventType || existing.payloadHash !== payloadHash) {
      throw new AzureDevOpsWebhookDeliveryConflictError(eventId);
    }
    if (existing.status !== "FAILED") {
      return { eventId: existing.id, status: existing.status, duplicate: true };
    }
    const claimed = await db.gitHubWebhookEvent.updateMany({
      where: { id: existing.id, status: "FAILED" },
      data: { status: "RECEIVED", processedAt: null },
    });
    if (claimed.count !== 1) {
      const latest = await db.gitHubWebhookEvent.findUnique({
        where: { provider_deliveryId: { provider: "AZURE_DEVOPS", deliveryId } },
      });
      if (!latest)
        throw new Error(`Azure DevOps delivery ${eventId} disappeared during retry claim.`);
      return { eventId: latest.id, status: latest.status, duplicate: true };
    }
    delivery = { ...existing, status: "RECEIVED" };
  }

  try {
    const persisted = await persistPullRequest(connection, event);
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
      return { eventId: delivery.id, status: "STALE", duplicate: false };
    }
    await db.gitHubWebhookEvent.update({
      where: { id: delivery.id },
      data: { status: "QUEUED" },
    });
    const jobId = await enqueueSourceControlWebhookEvent({
      provider: "AZURE_DEVOPS",
      eventType,
      deliveryId,
      payloadHash,
      organizationId: connection.organizationId,
      repositoryId: persisted.repositoryId,
    });
    return { eventId: delivery.id, jobId, status: "QUEUED", duplicate: false };
  } catch (error) {
    try {
      await db.gitHubWebhookEvent.update({
        where: { id: delivery.id },
        data: { status: "FAILED", processedAt: new Date() },
      });
    } catch (statusError) {
      throw new AggregateError(
        [error, statusError],
        `Azure DevOps delivery ${eventId} failed and its failure status could not be persisted.`,
      );
    }
    throw error;
  }
}
