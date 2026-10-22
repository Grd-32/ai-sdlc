import type { Context, Env } from "hono";

export interface RequestJsonObject {
  [key: string]: unknown;
  action?: unknown;
  active?: unknown;
  agreementName?: unknown;
  aiInvolved?: unknown;
  clientId?: unknown;
  comment?: unknown;
  confirmOrganizationSlug?: unknown;
  data?: unknown;
  dataProcessingAcknowledged?: unknown;
  decision?: unknown;
  description?: unknown;
  displayName?: unknown;
  domain?: unknown;
  email?: unknown;
  emails?: unknown;
  enabled?: unknown;
  entitlements?: unknown;
  expiresAt?: unknown;
  externalId?: unknown;
  groups?: unknown;
  idempotencyKey?: unknown;
  issuer?: unknown;
  metadata?: unknown;
  mode?: unknown;
  name?: unknown;
  Operations?: unknown;
  op?: unknown;
  path?: unknown;
  precedence?: unknown;
  repositoryCriticalityIn?: unknown;
  repositoryIds?: unknown;
  requiredApprovals?: unknown;
  requirement?: unknown;
  reviewerId?: unknown;
  riskAtLeast?: unknown;
  reason?: unknown;
  role?: unknown;
  sensitiveAreas?: unknown;
  slug?: unknown;
  ssoEnforced?: unknown;
  type?: unknown;
  userName?: unknown;
  value?: unknown;
  webhookRetentionDays?: unknown;
}

export async function readJsonObject<E extends Env>(
  context: Context<E>,
): Promise<RequestJsonObject | null> {
  try {
    const body: unknown = await context.req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    return body as RequestJsonObject;
  } catch {
    return null;
  }
}
