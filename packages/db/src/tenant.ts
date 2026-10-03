/**
 * Tenant ownership verification helpers (Milestone A).
 *
 * Every worker and service path must verify the ownership chain server-side —
 * never trust organizationId / repositoryId / pullRequestId from job payloads alone.
 */

import { prisma } from "./index.js";

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

/** Verify pull request belongs to organization and repository. */
export async function assertPullRequestOwnership(params: {
  organizationId: string;
  repositoryId: string;
  pullRequestId: string;
}): Promise<{ pullRequestId: string; organizationId: string; repositoryId: string }> {
  const pullRequest = await prisma.pullRequest.findFirst({
    where: {
      id: params.pullRequestId,
      organizationId: params.organizationId,
      repositoryId: params.repositoryId,
    },
    select: { id: true, organizationId: true, repositoryId: true },
  });

  if (!pullRequest) {
    throw new TenantIsolationError(
      `Pull request ${params.pullRequestId} not found in organization ${params.organizationId}`,
    );
  }

  return {
    pullRequestId: pullRequest.id,
    organizationId: pullRequest.organizationId,
    repositoryId: pullRequest.repositoryId,
  };
}

/** Verify repository belongs to organization. */
export async function assertRepositoryOwnership(params: {
  organizationId: string;
  repositoryId: string;
}): Promise<{ repositoryId: string; organizationId: string }> {
  const repository = await prisma.repository.findFirst({
    where: { id: params.repositoryId, organizationId: params.organizationId },
    select: { id: true, organizationId: true },
  });

  if (!repository) {
    throw new TenantIsolationError(
      `Repository ${params.repositoryId} not found in organization ${params.organizationId}`,
    );
  }

  return { repositoryId: repository.id, organizationId: repository.organizationId };
}
