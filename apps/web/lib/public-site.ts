export const PUBLIC_ROUTES = [
  "/",
  "/product",
  "/how-it-works",
  "/assessment",
  "/pricing",
  "/security",
  "/docs",
  "/contact",
  "/terms",
  "/privacy",
] as const;

export function getSiteOrigin(): string {
  const configured = process.env["NEXT_PUBLIC_SITE_URL"]?.trim() || process.env["APP_URL"]?.trim();
  if (!configured) return "http://localhost:3000";
  return new URL(configured).origin;
}

export function offerContactHref(offer: "professional" | "enterprise"): string {
  return `/contact?offer=${offer}`;
}

export const offerCopy = {
  professional:
    process.env["NEXT_PUBLIC_PROFESSIONAL_OFFER"] ??
    "For teams that want to evaluate Nomalog with their delivery workflow. Availability and commercial terms are discussed with the team.",
  enterprise:
    process.env["NEXT_PUBLIC_ENTERPRISE_OFFER"] ??
    "For organizations evaluating broader rollout, identity, governance, and operational requirements. Scope and commercial terms are discussed with the team.",
};
