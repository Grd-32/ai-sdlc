import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@ai-sdlc/db";
import { decryptSourceControlSecret } from "@ai-sdlc/source-control";
import { enqueuePullRequestAnalysis, enqueueSourceControlWebhookEvent } from "./queue.js";

type BitbucketWebhookConnection = {
  id: string;
  organizationId: string;
  webhookSecretCiphertext: string | null;
};

type BitbucketWebhookRepository = {
  id: string;
  organizationId: string;
  sourceControlConnectionId: string | null;
};

type PullRequestRecord = { id: string; updatedAt: Date };
type WebhookEventRecord = {
  id: string;
  status: string;
  eventType: string;
  payloadHash: string;
};

type BitbucketWebhookDb = {
  sourceControlConnection: {
    findFirst: (args: {
      where: { id: string; provider: string; active: boolean };
      select: { id: true; organizationId: true; webhookSecretCiphertext: true };
    }) => Promise<BitbucketWebhookConnection | null>;
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
    }) => Promise<BitbucketWebhookRepository | null>;
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
      update: { message: string; authorName: string | null; committedAt: Date };
      create: {
        organizationId: string;
        repositoryId: string;
        pullRequestId: string;
        sha: string;
        message: string;
        authorName: string | null;
        authorEmail: null;
        committedAt: Date;
      };
    }) => Promise<{ id: string }>;
  };
  gitHubWebhookEvent: {
    create: (args: { data: Record<string, unknown> }) => Promise<WebhookEventRecord>;
    findUnique: (args: {
      where: { provider_deliveryId: { provider: string; deliveryId: string } };
    }) => Promise<WebhookEventRecord | null>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<WebhookEventRecord>;
    updateMany: (args: {
      where: { id: string; status: string };
      data: { status: string; processedAt: Date | null };
    }) => Promise<{ count: number }>;
  };
};

const db = prisma as unknown as BitbucketWebhookDb;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const ANALYZABLE_EVENTS = new Set([
  "pullrequest:created",
  "pullrequest:updated",
  "pullrequest:approved",
  "pullrequest:unapproved",
]);
const SUPPORTED_EVENTS = new Set([
  ...ANALYZABLE_EVENTS,
  "pullrequest:fulfilled",
  "pullrequest:rejected",
]);

export class BitbucketWebhookAuthenticationError extends Error {
  constructor() {
    super("Bitbucket webhook authentication failed.");
    this.name = "BitbucketWebhookAuthenticationError";
  }
}

export class BitbucketWebhookDeliveryConflictError extends Error {
  constructor(deliveryId: string) {
    super(
      `Bitbucket webhook delivery ${deliveryId} was already received with a different payload.`,
    );
    this.name = "BitbucketWebhookDeliveryConflictError";
  }
}

export class BitbucketWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BitbucketWebhookPayloadError";
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

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parsePayload(payload: string): Record<string, unknown> {
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new BitbucketWebhookPayloadError("Bitbucket webhook body exceeds the 1 MiB limit.");
  }
  try {
    const value: unknown = JSON.parse(payload);
    const record = objectValue(value);
    if (!record)
      throw new BitbucketWebhookPayloadError("Bitbucket webhook body must be a JSON object.");
    return record;
  } catch (error) {
    if (error instanceof BitbucketWebhookPayloadError) throw error;
    throw new BitbucketWebhookPayloadError("Bitbucket webhook body must be valid JSON.");
  }
}

function dateValue(value: unknown, field: string): Date {
  const result = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(result.getTime())) {
    throw new BitbucketWebhookPayloadError(`Bitbucket pull request is missing a valid ${field}.`);
  }
  return result;
}

function signatureMatches(payload: string, signature: string, secret: string): boolean {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match?.[1]) return false;
  const supplied = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function safeWebhookPayload(
  eventType: string,
  repositoryUuid: string,
  pullRequest: Record<string, unknown>,
): Record<string, unknown> {
  const source = objectValue(pullRequest["source"]);
  const sourceCommit = objectValue(source?.["commit"]);
  return {
    eventType,
    repositoryUuid,
    pullRequestId: pullRequest["id"],
    state: pullRequest["state"],
    updatedAt: pullRequest["updated_on"],
    headSha: sourceCommit?.["hash"] ?? null,
  };
}

async function persistPullRequest(
  connection: BitbucketWebhookConnection,
  eventType: string,
  event: Record<string, unknown>,
): Promise<{ repositoryId: string; pullRequestId: string; analyze: boolean; stale: boolean }> {
  const repositoryData = objectValue(event["repository"]);
  const pullRequest = objectValue(event["pullrequest"]);
  const repositoryUuid = stringValue(repositoryData?.["uuid"]);
  const idValue = pullRequest?.["id"];
  const number = typeof idValue === "number" ? idValue : Number(idValue);
  if (!repositoryUuid || !Number.isSafeInteger(number) || number < 1 || !pullRequest) {
    throw new BitbucketWebhookPayloadError(
      "Bitbucket pull-request event is missing its repository or pull-request identifier.",
    );
  }
  const repository = await db.repository.findFirst({
    where: {
      organizationId: connection.organizationId,
      provider: "BITBUCKET",
      sourceControlConnectionId: connection.id,
      externalId: repositoryUuid,
      enabled: true,
    },
    select: { id: true, organizationId: true, sourceControlConnectionId: true },
  });
  if (
    !repository ||
    repository.organizationId !== connection.organizationId ||
    repository.sourceControlConnectionId !== connection.id
  ) {
    throw new BitbucketWebhookPayloadError(
      "Bitbucket repository is not selected for this organization.",
    );
  }

  const source = objectValue(pullRequest["source"]);
  const destination = objectValue(pullRequest["destination"]);
  const sourceBranch = objectValue(source?.["branch"]);
  const targetBranch = objectValue(destination?.["branch"]);
  const sourceCommit = objectValue(source?.["commit"]);
  const author = objectValue(pullRequest["author"]);
  const headSha = stringValue(sourceCommit?.["hash"]);
  const state = stringValue(pullRequest["state"])?.toUpperCase();
  if (!state || !["OPEN", "MERGED", "DECLINED", "SUPERSEDED"].includes(state)) {
    throw new BitbucketWebhookPayloadError("Bitbucket pull request has an unsupported state.");
  }
  const updatedAt = dateValue(pullRequest["updated_on"], "updated_on");
  const createdAt = dateValue(pullRequest["created_on"], "created_on");
  const closedAt = stringValue(pullRequest["closed_on"]);
  const mergedAt = state === "MERGED" && closedAt ? dateValue(closedAt, "closed_on") : null;
  const authorLogin = stringValue(author?.["nickname"]) ?? stringValue(author?.["display_name"]);
  const externalId = String(number);
  const data = {
    organizationId: connection.organizationId,
    repositoryId: repository.id,
    provider: "BITBUCKET",
    externalId,
    number,
    title: stringValue(pullRequest["title"]) ?? "Untitled pull request",
    state: state === "MERGED" ? "MERGED" : state === "OPEN" ? "OPEN" : "CLOSED",
    authorLogin,
    sourceBranch: stringValue(sourceBranch?.["name"]),
    targetBranch: stringValue(targetBranch?.["name"]),
    headSha,
    additions: 0,
    deletions: 0,
    changedFilesCount: 0,
    createdAt,
    updatedAt,
    mergedAt,
  };
  let existing = await db.pullRequest.findFirst({
    where: { repositoryId: repository.id, provider: "BITBUCKET", externalId },
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
        where: { repositoryId: repository.id, provider: "BITBUCKET", externalId },
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

  await db.commit.upsert({
    where: { repositoryId_sha: { repositoryId: repository.id, sha: headSha } },
    update: { message: data.title, authorName: authorLogin, committedAt: updatedAt },
    create: {
      organizationId: connection.organizationId,
      repositoryId: repository.id,
      pullRequestId,
      sha: headSha,
      message: data.title,
      authorName: authorLogin,
      authorEmail: null,
      committedAt: updatedAt,
    },
  });
  return {
    repositoryId: repository.id,
    pullRequestId,
    analyze: ANALYZABLE_EVENTS.has(eventType) && data.state === "OPEN",
    stale: false,
  };
}

export async function ingestBitbucketWebhookDelivery(
  connectionId: string,
  payload: string,
  headers: Record<string, string | undefined>,
): Promise<{
  eventId?: string;
  jobId?: string;
  status: string;
  duplicate: boolean;
  ignored?: boolean;
}> {
  if (!connectionId || connectionId.length > 128) throw new BitbucketWebhookAuthenticationError();
  const connection = await db.sourceControlConnection.findFirst({
    where: { id: connectionId, provider: "BITBUCKET", active: true },
    select: { id: true, organizationId: true, webhookSecretCiphertext: true },
  });
  const signature = headers["x-hub-signature"] ?? "";
  let secret: string | null = null;
  if (connection?.webhookSecretCiphertext) {
    try {
      secret = decryptSourceControlSecret(connection.webhookSecretCiphertext);
    } catch {
      secret = null;
    }
  }
  if (!connection || !secret || !signatureMatches(payload, signature, secret)) {
    throw new BitbucketWebhookAuthenticationError();
  }

  const eventType = headers["x-event-key"] ?? "";
  if (!eventType) {
    throw new BitbucketWebhookPayloadError("Bitbucket event type header is required.");
  }
  if (!SUPPORTED_EVENTS.has(eventType)) {
    return { status: "IGNORED_UNSUPPORTED_EVENT", duplicate: false, ignored: true };
  }
  const requestUuid = headers["x-request-uuid"] ?? "";
  if (!requestUuid || requestUuid.length > 128) {
    throw new BitbucketWebhookPayloadError("Bitbucket request UUID header is required.");
  }
  const event = parsePayload(payload);
  const repositoryData = objectValue(event["repository"]);
  const pullRequest = objectValue(event["pullrequest"]);
  const repositoryUuid = stringValue(repositoryData?.["uuid"]);
  if (!repositoryUuid || !pullRequest) {
    throw new BitbucketWebhookPayloadError(
      "Bitbucket pull-request event is missing repository data.",
    );
  }
  const repository = await db.repository.findFirst({
    where: {
      organizationId: connection.organizationId,
      provider: "BITBUCKET",
      sourceControlConnectionId: connection.id,
      externalId: repositoryUuid,
      enabled: true,
    },
    select: { id: true, organizationId: true, sourceControlConnectionId: true },
  });
  if (!repository) {
    return { status: "IGNORED_UNSELECTED_REPOSITORY", duplicate: false, ignored: true };
  }

  const deliveryId = `${connection.id}:${requestUuid}`;
  const payloadHash = createHash("sha256").update(payload, "utf8").digest("hex");
  let delivery: WebhookEventRecord;
  try {
    delivery = await db.gitHubWebhookEvent.create({
      data: {
        provider: "BITBUCKET",
        eventType,
        deliveryId,
        payloadHash,
        payload: safeWebhookPayload(eventType, repositoryUuid, pullRequest),
        organizationId: connection.organizationId,
        repositoryId: repository.id,
        status: "RECEIVED",
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await db.gitHubWebhookEvent.findUnique({
      where: { provider_deliveryId: { provider: "BITBUCKET", deliveryId } },
    });
    if (!existing) throw error;
    if (existing.eventType !== eventType || existing.payloadHash !== payloadHash) {
      throw new BitbucketWebhookDeliveryConflictError(requestUuid);
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
        where: { provider_deliveryId: { provider: "BITBUCKET", deliveryId } },
      });
      if (!latest)
        throw new Error(`Bitbucket delivery ${requestUuid} disappeared during retry claim.`);
      return { eventId: latest.id, status: latest.status, duplicate: true };
    }
    delivery = { ...existing, status: "RECEIVED" };
  }

  try {
    const persisted = await persistPullRequest(connection, eventType, event);
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
      provider: "BITBUCKET",
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
        `Bitbucket delivery ${requestUuid} failed and its failure status could not be persisted.`,
      );
    }
    throw error;
  }
}
