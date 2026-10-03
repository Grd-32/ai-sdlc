// import { createHash } from "node:crypto";
// import { prisma } from "@ai-sdlc/db";
// import { inferAIProvenanceFromPullRequest } from "@ai-sdlc/provenance";
// import { enqueueGitHubWebhookEvent, enqueuePullRequestAnalysis } from "./queue.js";

// type UpsertResult = {
//   id: string;
// };

// type RepositoryDelegate = {
//   upsert: (args: {
//     where: {
//       organizationId_provider_owner_name: {
//         organizationId: string;
//         provider: string;
//         owner: string;
//         name: string;
//       };
//     };
//     update: {
//       githubInstallationId: string | null;
//       defaultBranch: string | null;
//       metadata: Record<string, unknown>;
//       enabled: boolean;
//       updatedAt: Date;
//     };
//     create: {
//       organizationId: string;
//       githubInstallationId: string | null;
//       provider: string;
//       owner: string;
//       name: string;
//       defaultBranch: string | null;
//       enabled: boolean;
//       metadata: Record<string, unknown>;
//     };
//   }) => Promise<UpsertResult>;
// };

// type PullRequestDelegate = {
//   upsert: (args: {
//     where: {
//       repositoryId_provider_externalId: {
//         repositoryId: string;
//         provider: string;
//         externalId: string;
//       };
//     };
//     update: {
//       number: number;
//       title: string;
//       state: string;
//       authorLogin: string | null;
//       sourceBranch: string | null;
//       targetBranch: string | null;
//       headSha: string | null;
//       additions: number;
//       deletions: number;
//       changedFilesCount: number;
//       updatedAt: Date;
//       mergedAt: Date | null;
//     };
//     create: {
//       organizationId: string;
//       repositoryId: string;
//       provider: string;
//       externalId: string;
//       number: number;
//       title: string;
//       state: string;
//       authorLogin: string | null;
//       sourceBranch: string | null;
//       targetBranch: string | null;
//       headSha: string | null;
//       additions: number;
//       deletions: number;
//       changedFilesCount: number;
//       createdAt: Date;
//       updatedAt: Date;
//       mergedAt: Date | null;
//     };
//   }) => Promise<UpsertResult>;
// };

// type CommitDelegate = {
//   upsert: (args: {
//     where: {
//       repositoryId_sha: {
//         repositoryId: string;
//         sha: string;
//       };
//     };
//     update: {
//       message: string;
//       authorName: string | null;
//       committedAt: Date | null;
//     };
//     create: {
//       organizationId: string;
//       repositoryId: string;
//       sha: string;
//       message: string;
//       authorName: string | null;
//       authorEmail: string | null;
//       committedAt: Date | null;
//     };
//   }) => Promise<UpsertResult>;
// };

// type AIActivityDelegate = {
//   findFirst: (args: {
//     where: {
//       organizationId: string;
//       repositoryId: string;
//       pullRequestId: string;
//       agent: string;
//       model: string | null;
//       source: string;
//     };
//     select: {
//       id: true;
//     };
//   }) => Promise<{ id: string } | null>;
//   update: (args: {
//     where: {
//       id: string;
//     };
//     data: {
//       agent: string;
//       model: string | null;
//       involvement: string;
//       confidence: number;
//       source: string;
//       metadata: Record<string, unknown> | null;
//     };
//   }) => Promise<{ id: string }>;
//   create: (args: {
//     data: {
//       organizationId: string;
//       repositoryId: string;
//       pullRequestId: string;
//       agent: string;
//       model: string | null;
//       involvement: string;
//       confidence: number;
//       source: string;
//       metadata: Record<string, unknown> | null;
//     };
//   }) => Promise<{ id: string }>;
// };

// type GitHubInstallationDelegate = {
//   findFirst: (args: {
//     where: {
//       githubInstallationId: string;
//     };
//     select: {
//       id: true;
//       organizationId: true;
//     };
//   }) => Promise<{ id: string; organizationId: string } | null>;
// };

// type GitHubWebhookEventDelegate = {
//   upsert: (args: {
//     where: {
//       provider_deliveryId: {
//         provider: string;
//         deliveryId: string;
//       };
//     };
//     update: {
//       eventType: string;
//       payloadHash: string;
//       payload: unknown;
//       organizationId?: string | null;
//       installationId?: string | null;
//       repositoryId?: string | null;
//       status: string;
//       processedAt: null;
//     };
//     create: {
//       provider: string;
//       eventType: string;
//       deliveryId: string;
//       payloadHash: string;
//       payload: unknown;
//       organizationId?: string | null;
//       installationId?: string | null;
//       repositoryId?: string | null;
//       status: string;
//     };
//   }) => Promise<{ id: string; status: string }>;
// };

// type PrismaWebhookClient = {
//   repository: RepositoryDelegate;
//   pullRequest: PullRequestDelegate;
//   commit: CommitDelegate;
//   // Prisma Client only lowercases the FIRST character of a model name when
//   // generating the client property. The schema model is `AIActivity` (two
//   // capital letters up front), so the real generated property is `aIActivity`
//   // (capital I) — not `aiActivity`.
//   aIActivity: AIActivityDelegate;
//   gitHubInstallation: GitHubInstallationDelegate;
//   gitHubWebhookEvent: GitHubWebhookEventDelegate;
// };

// const db = prisma as unknown as PrismaWebhookClient;

// // PR events that should trigger re-analysis. GitHub also sends `pull_request` for
// // actions like `labeled`, `assigned`, `closed`, etc. — re-running the full analysis
// // pipeline (and re-publishing a Check Run) for those would be wasted work and log noise.
// const ANALYZABLE_PULL_REQUEST_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

// export interface GitHubWebhookEnvelope {
//   eventType: string;
//   deliveryId: string;
//   payloadHash: string;
//   payload: unknown;
//   installationId?: string;
//   // NOTE: this is GitHub's own external repository ID (a plain numeric string
//   // from the webhook payload), NOT our internal Repository.id (a cuid). Do not
//   // write this value into any column that's a foreign key into our Repository
//   // table — see internalRepositoryId in ingestGitHubWebhookDelivery below.
//   repositoryId?: string;
//   organizationId?: string;
// }

// export function parseGitHubWebhookEnvelope(
//   payload: string,
//   headers: Record<string, string | undefined>,
// ): GitHubWebhookEnvelope {
//   const eventType = headers["x-github-event"] ?? "unknown";
//   const deliveryId = headers["x-github-delivery"] ?? "";

//   if (!deliveryId) {
//     throw new Error("GitHub webhook delivery ID is required");
//   }

//   let parsedPayload: unknown;
//   try {
//     parsedPayload = JSON.parse(payload) as unknown;
//   } catch {
//     parsedPayload = { raw: payload };
//   }

//   const installationCandidate = (parsedPayload as { installation?: { id?: string | number } }).installation;
//   const repositoryCandidate = (parsedPayload as { repository?: { id?: string | number } }).repository;

//   const installationId =
//     installationCandidate &&
//     (typeof installationCandidate.id === "number" || typeof installationCandidate.id === "string")
//       ? String(installationCandidate.id)
//       : undefined;

//   const repositoryId =
//     repositoryCandidate &&
//     (typeof repositoryCandidate.id === "number" || typeof repositoryCandidate.id === "string")
//       ? String(repositoryCandidate.id)
//       : undefined;

//   const payloadHash = createHash("sha256").update(payload, "utf8").digest("hex");

//   return {
//     eventType,
//     deliveryId,
//     payloadHash,
//     payload: parsedPayload,
//     installationId,
//     repositoryId,
//   };
// }

// async function persistAIActivityForPullRequest(
//   organizationId: string,
//   repositoryId: string,
//   pullRequestId: string,
//   payload: {
//     pull_request?: {
//       id?: string | number;
//       title?: string;
//       body?: string | null;
//       user?: { login?: string | null } | null;
//       head?: { ref?: string | null; sha?: string | null } | null;
//     };
//   },
// ): Promise<void> {
//   const provenance = inferAIProvenanceFromPullRequest({
//     title: payload.pull_request?.title,
//     body: payload.pull_request?.body ?? null,
//     user: payload.pull_request?.user ?? null,
//     head: payload.pull_request?.head ?? null,
//   });

//   const agentName = provenance.agentName ?? "unknown";
//   const modelName = provenance.modelName ?? null;
//   const source = provenance.source;

//   const existing = await db.aIActivity.findFirst({
//     where: {
//       organizationId,
//       repositoryId,
//       pullRequestId,
//       agent: agentName,
//       model: modelName,
//       source,
//     },
//     select: {
//       id: true,
//     },
//   });

//   const metadata = {
//     evidence: provenance.evidence,
//   };

//   if (existing) {
//     await db.aIActivity.update({
//       where: { id: existing.id },
//       data: {
//         agent: agentName,
//         model: modelName,
//         involvement: provenance.involvement,
//         confidence: provenance.confidence,
//         source,
//         metadata,
//       },
//     });
//     return;
//   }

//   await db.aIActivity.create({
//     data: {
//       organizationId,
//       repositoryId,
//       pullRequestId,
//       agent: agentName,
//       model: modelName,
//       involvement: provenance.involvement,
//       confidence: provenance.confidence,
//       source,
//       metadata,
//     },
//   });
// }

// export async function persistGitHubPullRequestEvent(
//   organizationId: string,
//   // Internal GitHubInstallation.id (a cuid) — NOT GitHub's own installation
//   // number. Threaded through so the Repository row can be linked to its
//   // installation; without this, apps/worker/src/processors/analyze.ts can
//   // never resolve an installation for the repo and silently skips every
//   // GitHub API call (file listing, Check Run publishing).
//   installationId: string,
//   payload: {
//     repository?: {
//       id?: string | number;
//       name?: string;
//       full_name?: string;
//       owner?: { login?: string } | null;
//       default_branch?: string | null;
//       private?: boolean;
//     };
//     pull_request?: {
//       id?: string | number;
//       number?: number;
//       title?: string;
//       state?: string;
//       user?: { login?: string } | null;
//       head?: { ref?: string | null; sha?: string | null } | null;
//       base?: { ref?: string | null } | null;
//       created_at?: string | null;
//       updated_at?: string | null;
//       merged_at?: string | null;
//       additions?: number;
//       deletions?: number;
//       changed_files?: number;
//     };
//   },
// ): Promise<{ repositoryId: string; pullRequestId: string; headSha: string | null }> {
//   const repository = payload.repository;
//   const pullRequest = payload.pull_request;

//   if (!repository || !pullRequest) {
//     throw new Error("pull_request payload is missing repository or pull_request data");
//   }

//   const repoOwner = repository.owner?.login ?? "unknown";
//   const repoName = repository.name ?? repository.full_name?.split("/")[1] ?? "unknown";

//   const repoUpsert = await db.repository.upsert({
//     where: {
//       organizationId_provider_owner_name: {
//         organizationId,
//         provider: "GITHUB",
//         owner: repoOwner,
//         name: repoName,
//       },
//     },
//     update: {
//       githubInstallationId: installationId,
//       defaultBranch: repository.default_branch ?? null,
//       metadata: {
//         private: repository.private ?? false,
//         source: "github_pull_request_webhook",
//       },
//       enabled: true,
//       updatedAt: new Date(),
//     },
//     create: {
//       organizationId,
//       githubInstallationId: installationId,
//       provider: "GITHUB",
//       owner: repoOwner,
//       name: repoName,
//       defaultBranch: repository.default_branch ?? null,
//       enabled: true,
//       metadata: {
//         private: repository.private ?? false,
//         source: "github_pull_request_webhook",
//       },
//     },
//   });

//   const prNumber = pullRequest.number ?? 0;
//   const externalId = String(pullRequest.id ?? `${repoName}-${prNumber}`);
//   const headSha = pullRequest.head?.sha ?? null;

//   const pullRequestUpsert = await db.pullRequest.upsert({
//     where: {
//       repositoryId_provider_externalId: {
//         repositoryId: repoUpsert.id,
//         provider: "GITHUB",
//         externalId,
//       },
//     },
//     update: {
//       number: prNumber,
//       title: pullRequest.title ?? "Untitled pull request",
//       state: pullRequest.state ?? "OPEN",
//       authorLogin: pullRequest.user?.login ?? null,
//       sourceBranch: pullRequest.head?.ref ?? null,
//       targetBranch: pullRequest.base?.ref ?? null,
//       headSha,
//       additions: pullRequest.additions ?? 0,
//       deletions: pullRequest.deletions ?? 0,
//       changedFilesCount: pullRequest.changed_files ?? 0,
//       updatedAt: new Date(pullRequest.updated_at ?? Date.now()),
//       mergedAt: pullRequest.merged_at ? new Date(pullRequest.merged_at) : null,
//     },
//     create: {
//       organizationId,
//       repositoryId: repoUpsert.id,
//       provider: "GITHUB",
//       externalId,
//       number: prNumber,
//       title: pullRequest.title ?? "Untitled pull request",
//       state: pullRequest.state ?? "OPEN",
//       authorLogin: pullRequest.user?.login ?? null,
//       sourceBranch: pullRequest.head?.ref ?? null,
//       targetBranch: pullRequest.base?.ref ?? null,
//       headSha,
//       additions: pullRequest.additions ?? 0,
//       deletions: pullRequest.deletions ?? 0,
//       changedFilesCount: pullRequest.changed_files ?? 0,
//       createdAt: new Date(pullRequest.created_at ?? Date.now()),
//       updatedAt: new Date(pullRequest.updated_at ?? Date.now()),
//       mergedAt: pullRequest.merged_at ? new Date(pullRequest.merged_at) : null,
//     },
//   });

//   if (pullRequest.head?.sha) {
//     await db.commit.upsert({
//       where: {
//         repositoryId_sha: {
//           repositoryId: repoUpsert.id,
//           sha: pullRequest.head.sha,
//         },
//       },
//       update: {
//         message: pullRequest.title ?? "GitHub pull request head commit",
//         authorName: pullRequest.user?.login ?? null,
//         committedAt: pullRequest.created_at ? new Date(pullRequest.created_at) : null,
//       },
//       create: {
//         organizationId,
//         repositoryId: repoUpsert.id,
//         sha: pullRequest.head.sha,
//         message: pullRequest.title ?? "GitHub pull request head commit",
//         authorName: pullRequest.user?.login ?? null,
//         authorEmail: null,
//         committedAt: pullRequest.created_at ? new Date(pullRequest.created_at) : null,
//       },
//     });
//   }

//   await persistAIActivityForPullRequest(organizationId, repoUpsert.id, pullRequestUpsert.id, {
//     pull_request: pullRequest,
//   });

//   return {
//     repositoryId: repoUpsert.id,
//     pullRequestId: pullRequestUpsert.id,
//     headSha,
//   };
// }

// export async function ingestGitHubWebhookDelivery(
//   payload: string,
//   headers: Record<string, string | undefined>,
// ): Promise<{ eventId: string; jobId: string; status: string }> {
//   const envelope = parseGitHubWebhookEnvelope(payload, headers);
//   const jsonPayload = envelope.payload;

//   const installation = envelope.installationId
//     ? await db.gitHubInstallation.findFirst({
//         where: {
//           githubInstallationId: envelope.installationId,
//         },
//         select: {
//           id: true,
//           organizationId: true,
//         },
//       })
//     : null;

//   const organizationId = installation?.organizationId ?? undefined;

//   // Only ever set this to a Repository.id we've actually resolved internally
//   // (via persistGitHubPullRequestEvent below) — never to envelope.repositoryId,
//   // which is GitHub's own external repo ID and lives in a different ID space
//   // than our cuid primary keys.
//   let internalRepositoryId: string | undefined;

//   if (envelope.eventType === "pull_request" && organizationId && installation) {
//     const eventPayload = envelope.payload as {
//       action?: string;
//       repository?: {
//         id?: string | number;
//         name?: string;
//         full_name?: string;
//         owner?: { login?: string } | null;
//         default_branch?: string | null;
//         private?: boolean;
//       };
//       pull_request?: {
//         id?: string | number;
//         number?: number;
//         title?: string;
//         state?: string;
//         user?: { login?: string } | null;
//         head?: { ref?: string | null; sha?: string | null } | null;
//         base?: { ref?: string | null } | null;
//         created_at?: string | null;
//         updated_at?: string | null;
//         merged_at?: string | null;
//         additions?: number;
//         deletions?: number;
//         changed_files?: number;
//       };
//     };

//     const persistResult = await persistGitHubPullRequestEvent(organizationId, installation.id, eventPayload);
//     internalRepositoryId = persistResult.repositoryId;

//     if (ANALYZABLE_PULL_REQUEST_ACTIONS.has(eventPayload.action ?? "")) {
//       await enqueuePullRequestAnalysis({
//         organizationId,
//         repositoryId: persistResult.repositoryId,
//         pullRequestId: persistResult.pullRequestId,
//       });
//     }
//   }

//   const event = await db.gitHubWebhookEvent.upsert({
//     where: {
//       provider_deliveryId: {
//         provider: "GITHUB",
//         deliveryId: envelope.deliveryId,
//       },
//     },
//     update: {
//       eventType: envelope.eventType,
//       payloadHash: envelope.payloadHash,
//       payload: jsonPayload,
//       organizationId,
//       installationId: installation?.id ?? undefined,
//       repositoryId: internalRepositoryId,
//       status: "RECEIVED",
//       processedAt: null,
//     },
//     create: {
//       provider: "GITHUB",
//       eventType: envelope.eventType,
//       deliveryId: envelope.deliveryId,
//       payloadHash: envelope.payloadHash,
//       payload: jsonPayload,
//       organizationId,
//       installationId: installation?.id ?? undefined,
//       repositoryId: internalRepositoryId,
//       status: "RECEIVED",
//     },
//   });

//   const jobId = await enqueueGitHubWebhookEvent({
//     eventType: envelope.eventType,
//     deliveryId: envelope.deliveryId,
//     payloadHash: envelope.payloadHash,
//     payload: envelope.payload,
//     installationId: installation?.id ?? envelope.installationId,
//     repositoryId: internalRepositoryId,
//     organizationId,
//   });

//   return {
//     eventId: event.id,
//     jobId,
//     status: event.status,
//   };
// }
import { createHash } from "node:crypto";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { inferAIProvenanceFromPullRequest } from "@ai-sdlc/provenance";
import { enqueueGitHubWebhookEvent, enqueuePullRequestAnalysis } from "./queue.js";

type UpsertResult = {
  id: string;
};

type RepositoryDelegate = {
  upsert: (args: {
    where: {
      organizationId_provider_owner_name: {
        organizationId: string;
        provider: string;
        owner: string;
        name: string;
      };
    };
    update: {
      githubInstallationId: string | null;
      defaultBranch: string | null;
      metadata: Record<string, unknown>;
      enabled: boolean;
      updatedAt: Date;
    };
    create: {
      organizationId: string;
      githubInstallationId: string | null;
      provider: string;
      owner: string;
      name: string;
      defaultBranch: string | null;
      enabled: boolean;
      metadata: Record<string, unknown>;
    };
  }) => Promise<UpsertResult>;
};

type PullRequestDelegate = {
  upsert: (args: {
    where: {
      repositoryId_provider_externalId: {
        repositoryId: string;
        provider: string;
        externalId: string;
      };
    };
    update: {
      number: number;
      title: string;
      state: string;
      authorLogin: string | null;
      sourceBranch: string | null;
      targetBranch: string | null;
      headSha: string | null;
      additions: number;
      deletions: number;
      changedFilesCount: number;
      updatedAt: Date;
      mergedAt: Date | null;
    };
    create: {
      organizationId: string;
      repositoryId: string;
      provider: string;
      externalId: string;
      number: number;
      title: string;
      state: string;
      authorLogin: string | null;
      sourceBranch: string | null;
      targetBranch: string | null;
      headSha: string | null;
      additions: number;
      deletions: number;
      changedFilesCount: number;
      createdAt: Date;
      updatedAt: Date;
      mergedAt: Date | null;
    };
  }) => Promise<UpsertResult>;
};

type CommitDelegate = {
  upsert: (args: {
    where: {
      repositoryId_sha: {
        repositoryId: string;
        sha: string;
      };
    };
    update: {
      message: string;
      authorName: string | null;
      committedAt: Date | null;
    };
    create: {
      organizationId: string;
      repositoryId: string;
      sha: string;
      message: string;
      authorName: string | null;
      authorEmail: string | null;
      committedAt: Date | null;
    };
  }) => Promise<UpsertResult>;
};

type AIActivityDelegate = {
  findFirst: (args: {
    where: {
      organizationId: string;
      repositoryId: string;
      pullRequestId: string;
      agent: string;
      model: string | null;
      source: string;
    };
    select: {
      id: true;
    };
  }) => Promise<{ id: string } | null>;
  update: (args: {
    where: {
      id: string;
    };
    data: {
      agent: string;
      model: string | null;
      involvement: string;
      confidence: number;
      source: string;
      metadata: Record<string, unknown> | null;
    };
  }) => Promise<{ id: string }>;
  create: (args: {
    data: {
      organizationId: string;
      repositoryId: string;
      pullRequestId: string;
      agent: string;
      model: string | null;
      involvement: string;
      confidence: number;
      source: string;
      metadata: Record<string, unknown> | null;
    };
  }) => Promise<{ id: string }>;
};

type GitHubInstallationDelegate = {
  findFirst: (args: {
    where: {
      githubInstallationId: string;
    };
    select: {
      id: true;
      organizationId: true;
    };
  }) => Promise<{ id: string; organizationId: string } | null>;
};

type GitHubWebhookEventDelegate = {
  upsert: (args: {
    where: {
      provider_deliveryId: {
        provider: string;
        deliveryId: string;
      };
    };
    update: {
      eventType: string;
      payloadHash: string;
      payload: unknown;
      organizationId?: string | null;
      installationId?: string | null;
      repositoryId?: string | null;
      status: string;
      processedAt: null;
    };
    create: {
      provider: string;
      eventType: string;
      deliveryId: string;
      payloadHash: string;
      payload: unknown;
      organizationId?: string | null;
      installationId?: string | null;
      repositoryId?: string | null;
      status: string;
    };
  }) => Promise<{ id: string; status: string }>;
};

type PrismaWebhookClient = {
  repository: RepositoryDelegate;
  pullRequest: PullRequestDelegate;
  commit: CommitDelegate;
  // Prisma Client only lowercases the FIRST character of a model name when
  // generating the client property. The schema model is `AIActivity` (two
  // capital letters up front), so the real generated property is `aIActivity`
  // (capital I) — not `aiActivity`.
  aIActivity: AIActivityDelegate;
  gitHubInstallation: GitHubInstallationDelegate;
  gitHubWebhookEvent: GitHubWebhookEventDelegate;
};

const db = prisma as unknown as PrismaWebhookClient;

// PR events that should trigger re-analysis. GitHub also sends `pull_request` for
// actions like `labeled`, `assigned`, `closed`, etc. — re-running the full analysis
// pipeline (and re-publishing a Check Run) for those would be wasted work and log noise.
const ANALYZABLE_PULL_REQUEST_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

export interface GitHubWebhookEnvelope {
  eventType: string;
  deliveryId: string;
  payloadHash: string;
  payload: unknown;
  installationId?: string;
  // NOTE: this is GitHub's own external repository ID (a plain numeric string
  // from the webhook payload), NOT our internal Repository.id (a cuid). Do not
  // write this value into any column that's a foreign key into our Repository
  // table.
  repositoryId?: string;
  organizationId?: string;
}

export function parseGitHubWebhookEnvelope(
  payload: string,
  headers: Record<string, string | undefined>,
): GitHubWebhookEnvelope {
  const eventType = headers["x-github-event"] ?? "unknown";
  const deliveryId = headers["x-github-delivery"] ?? "";

  if (!deliveryId) {
    throw new Error("GitHub webhook delivery ID is required");
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload) as unknown;
  } catch {
    parsedPayload = { raw: payload };
  }

  const installationCandidate = (parsedPayload as { installation?: { id?: string | number } }).installation;
  const repositoryCandidate = (parsedPayload as { repository?: { id?: string | number } }).repository;

  const installationId =
    installationCandidate &&
    (typeof installationCandidate.id === "number" || typeof installationCandidate.id === "string")
      ? String(installationCandidate.id)
      : undefined;

  const repositoryId =
    repositoryCandidate &&
    (typeof repositoryCandidate.id === "number" || typeof repositoryCandidate.id === "string")
      ? String(repositoryCandidate.id)
      : undefined;

  const payloadHash = createHash("sha256").update(payload, "utf8").digest("hex");

  return {
    eventType,
    deliveryId,
    payloadHash,
    payload: parsedPayload,
    installationId,
    repositoryId,
  };
}

async function persistAIActivityForPullRequest(
  organizationId: string,
  repositoryId: string,
  pullRequestId: string,
  payload: {
    pull_request?: {
      id?: string | number;
      title?: string;
      body?: string | null;
      user?: { login?: string | null } | null;
      head?: { ref?: string | null; sha?: string | null } | null;
    };
  },
): Promise<void> {
  const provenance = inferAIProvenanceFromPullRequest({
    title: payload.pull_request?.title,
    body: payload.pull_request?.body ?? null,
    user: payload.pull_request?.user ?? null,
    head: payload.pull_request?.head ?? null,
  });

  const agentName = provenance.agentName ?? "unknown";
  const modelName = provenance.modelName ?? null;
  const source = provenance.source;

  const existing = await db.aIActivity.findFirst({
    where: {
      organizationId,
      repositoryId,
      pullRequestId,
      agent: agentName,
      model: modelName,
      source,
    },
    select: {
      id: true,
    },
  });

  const metadata = {
    evidence: provenance.evidence,
  };

  if (existing) {
    await db.aIActivity.update({
      where: { id: existing.id },
      data: {
        agent: agentName,
        model: modelName,
        involvement: provenance.involvement,
        confidence: provenance.confidence,
        source,
        metadata,
      },
    });
    return;
  }

  await db.aIActivity.create({
    data: {
      organizationId,
      repositoryId,
      pullRequestId,
      agent: agentName,
      model: modelName,
      involvement: provenance.involvement,
      confidence: provenance.confidence,
      source,
      metadata,
    },
  });
}

export async function persistGitHubPullRequestEvent(
  organizationId: string,
  // Internal GitHubInstallation.id (a cuid) — NOT GitHub's own installation
  // number. Threaded through so the Repository row can be linked to its
  // installation.
  installationId: string,
  payload: {
    repository?: {
      id?: string | number;
      name?: string;
      full_name?: string;
      owner?: { login?: string } | null;
      default_branch?: string | null;
      private?: boolean;
    };
    pull_request?: {
      id?: string | number;
      number?: number;
      title?: string;
      state?: string;
      user?: { login?: string } | null;
      head?: { ref?: string | null; sha?: string | null } | null;
      base?: { ref?: string | null } | null;
      created_at?: string | null;
      updated_at?: string | null;
      merged_at?: string | null;
      additions?: number;
      deletions?: number;
      changed_files?: number;
    };
  },
): Promise<{ repositoryId: string; pullRequestId: string; headSha: string | null }> {
  const repository = payload.repository;
  const pullRequest = payload.pull_request;

  if (!repository || !pullRequest) {
    throw new Error("pull_request payload is missing repository or pull_request data");
  }

  const repoOwner = repository.owner?.login ?? "unknown";
  const repoName = repository.name ?? repository.full_name?.split("/")[1] ?? "unknown";

  const repoUpsert = await db.repository.upsert({
    where: {
      organizationId_provider_owner_name: {
        organizationId,
        provider: "GITHUB",
        owner: repoOwner,
        name: repoName,
      },
    },
    update: {
      githubInstallationId: installationId,
      defaultBranch: repository.default_branch ?? null,
      metadata: {
        private: repository.private ?? false,
        source: "github_pull_request_webhook",
      },
      enabled: true,
      updatedAt: new Date(),
    },
    create: {
      organizationId,
      githubInstallationId: installationId,
      provider: "GITHUB",
      owner: repoOwner,
      name: repoName,
      defaultBranch: repository.default_branch ?? null,
      enabled: true,
      metadata: {
        private: repository.private ?? false,
        source: "github_pull_request_webhook",
      },
    },
  });

  const prNumber = pullRequest.number ?? 0;
  const externalId = String(pullRequest.id ?? `${repoName}-${prNumber}`);
  const headSha = pullRequest.head?.sha ?? null;

  const pullRequestUpsert = await db.pullRequest.upsert({
    where: {
      repositoryId_provider_externalId: {
        repositoryId: repoUpsert.id,
        provider: "GITHUB",
        externalId,
      },
    },
    update: {
      number: prNumber,
      title: pullRequest.title ?? "Untitled pull request",
      state: pullRequest.state ?? "OPEN",
      authorLogin: pullRequest.user?.login ?? null,
      sourceBranch: pullRequest.head?.ref ?? null,
      targetBranch: pullRequest.base?.ref ?? null,
      headSha,
      additions: pullRequest.additions ?? 0,
      deletions: pullRequest.deletions ?? 0,
      changedFilesCount: pullRequest.changed_files ?? 0,
      updatedAt: new Date(pullRequest.updated_at ?? Date.now()),
      mergedAt: pullRequest.merged_at ? new Date(pullRequest.merged_at) : null,
    },
    create: {
      organizationId,
      repositoryId: repoUpsert.id,
      provider: "GITHUB",
      externalId,
      number: prNumber,
      title: pullRequest.title ?? "Untitled pull request",
      state: pullRequest.state ?? "OPEN",
      authorLogin: pullRequest.user?.login ?? null,
      sourceBranch: pullRequest.head?.ref ?? null,
      targetBranch: pullRequest.base?.ref ?? null,
      headSha,
      additions: pullRequest.additions ?? 0,
      deletions: pullRequest.deletions ?? 0,
      changedFilesCount: pullRequest.changed_files ?? 0,
      createdAt: new Date(pullRequest.created_at ?? Date.now()),
      updatedAt: new Date(pullRequest.updated_at ?? Date.now()),
      mergedAt: pullRequest.merged_at ? new Date(pullRequest.merged_at) : null,
    },
  });

  if (pullRequest.head?.sha) {
    await db.commit.upsert({
      where: {
        repositoryId_sha: {
          repositoryId: repoUpsert.id,
          sha: pullRequest.head.sha,
        },
      },
      update: {
        message: pullRequest.title ?? "GitHub pull request head commit",
        authorName: pullRequest.user?.login ?? null,
        committedAt: pullRequest.created_at ? new Date(pullRequest.created_at) : null,
      },
      create: {
        organizationId,
        repositoryId: repoUpsert.id,
        sha: pullRequest.head.sha,
        message: pullRequest.title ?? "GitHub pull request head commit",
        authorName: pullRequest.user?.login ?? null,
        authorEmail: null,
        committedAt: pullRequest.created_at ? new Date(pullRequest.created_at) : null,
      },
    });
  }

  await persistAIActivityForPullRequest(organizationId, repoUpsert.id, pullRequestUpsert.id, {
    pull_request: pullRequest,
  });

  return {
    repositoryId: repoUpsert.id,
    pullRequestId: pullRequestUpsert.id,
    headSha,
  };
}

/**
 * Phase 14: handle the `installation` webhook's `deleted` action — closes
 * the loop on uninstalls. Without this, revoking the App on GitHub had no
 * effect on our side: the GitHubInstallation row (and its repositories)
 * would stay "active" forever, which is a real hygiene/security gap, not
 * just a cosmetic one.
 *
 * Uses `prisma` directly rather than the hand-rolled `db` cast above — this
 * is new code and the real, fully-typed client is safer than extending the
 * manual delegate types by hand (see the aIActivity casing bug this
 * approach already caused once tonight).
 */
async function handleInstallationDeleted(githubInstallationId: string): Promise<void> {
  const existing = await prisma.gitHubInstallation.findFirst({
    where: { githubInstallationId },
  });

  if (!existing) {
    return;
  }

  await prisma.gitHubInstallation.update({
    where: { id: existing.id },
    data: { active: false },
  });

  await prisma.repository.updateMany({
    where: { githubInstallationId: existing.id },
    data: { enabled: false },
  });

  await recordAuditEvent({
    organizationId: existing.organizationId,
    eventType: "GITHUB_INSTALLATION_REMOVED",
    metadata: { githubInstallationId },
  });
}

export async function ingestGitHubWebhookDelivery(
  payload: string,
  headers: Record<string, string | undefined>,
): Promise<{ eventId: string; jobId: string; status: string }> {
  const envelope = parseGitHubWebhookEnvelope(payload, headers);
  const jsonPayload = envelope.payload;

  if (envelope.eventType === "installation") {
    const installationPayload = envelope.payload as { action?: string };
    if (installationPayload.action === "deleted" && envelope.installationId) {
      await handleInstallationDeleted(envelope.installationId);
    }
  }

  const installation = envelope.installationId
    ? await db.gitHubInstallation.findFirst({
        where: {
          githubInstallationId: envelope.installationId,
        },
        select: {
          id: true,
          organizationId: true,
        },
      })
    : null;

  const organizationId = installation?.organizationId ?? undefined;

  // Only ever set this to a Repository.id we've actually resolved internally
  // (via persistGitHubPullRequestEvent below) — never to envelope.repositoryId,
  // which is GitHub's own external repo ID and lives in a different ID space
  // than our cuid primary keys.
  let internalRepositoryId: string | undefined;

  if (envelope.eventType === "pull_request" && organizationId && installation) {
    const eventPayload = envelope.payload as {
      action?: string;
      repository?: {
        id?: string | number;
        name?: string;
        full_name?: string;
        owner?: { login?: string } | null;
        default_branch?: string | null;
        private?: boolean;
      };
      pull_request?: {
        id?: string | number;
        number?: number;
        title?: string;
        state?: string;
        user?: { login?: string } | null;
        head?: { ref?: string | null; sha?: string | null } | null;
        base?: { ref?: string | null } | null;
        created_at?: string | null;
        updated_at?: string | null;
        merged_at?: string | null;
        additions?: number;
        deletions?: number;
        changed_files?: number;
      };
    };

    const persistResult = await persistGitHubPullRequestEvent(organizationId, installation.id, eventPayload);
    internalRepositoryId = persistResult.repositoryId;

    if (ANALYZABLE_PULL_REQUEST_ACTIONS.has(eventPayload.action ?? "")) {
      await enqueuePullRequestAnalysis({
        organizationId,
        repositoryId: persistResult.repositoryId,
        pullRequestId: persistResult.pullRequestId,
      });
    }
  }

  const event = await db.gitHubWebhookEvent.upsert({
    where: {
      provider_deliveryId: {
        provider: "GITHUB",
        deliveryId: envelope.deliveryId,
      },
    },
    update: {
      eventType: envelope.eventType,
      payloadHash: envelope.payloadHash,
      payload: jsonPayload,
      organizationId,
      installationId: installation?.id ?? undefined,
      repositoryId: internalRepositoryId,
      status: "RECEIVED",
      processedAt: null,
    },
    create: {
      provider: "GITHUB",
      eventType: envelope.eventType,
      deliveryId: envelope.deliveryId,
      payloadHash: envelope.payloadHash,
      payload: jsonPayload,
      organizationId,
      installationId: installation?.id ?? undefined,
      repositoryId: internalRepositoryId,
      status: "RECEIVED",
    },
  });

  const jobId = await enqueueGitHubWebhookEvent({
    eventType: envelope.eventType,
    deliveryId: envelope.deliveryId,
    payloadHash: envelope.payloadHash,
    payload: envelope.payload,
    installationId: installation?.id ?? envelope.installationId,
    repositoryId: internalRepositoryId,
    organizationId,
  });

  return {
    eventId: event.id,
    jobId,
    status: event.status,
  };
}