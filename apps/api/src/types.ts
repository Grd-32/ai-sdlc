import type { OrganizationRole } from "@ai-sdlc/db";

export interface AppEnv {
  Variables: {
    requestId: string;
    correlationId: string;
    userId: string;
    organizationId: string;
    organizationRole: OrganizationRole;
  };
}