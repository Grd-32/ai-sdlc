import type { OrganizationRole } from "@ai-sdlc/db";

export interface AppEnv {
  Variables: {
    requestId: string;
    correlationId: string;
    userId: string;
    authenticationMethod: "GITHUB" | "OIDC" | "SAML";
    identityProviderId: string | null;
    organizationId: string;
    organizationRole: OrganizationRole;
  };
}
