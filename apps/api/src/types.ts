import type { OrganizationRole } from "@ai-sdlc/db";

export interface AppEnv {
  Variables: {
    userId: string;
    organizationId: string;
    organizationRole: OrganizationRole;
  };
}