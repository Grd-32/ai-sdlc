# Security Policy

## Supported security posture

AI-SDLC is an internal security control plane for AI-assisted software delivery. The project uses environment-scoped configuration, tenant-aware authorization, webhook signature verification, and retention policies for operational cleanup. These controls are intentionally designed to be auditable and reviewable, but they are not a substitute for a production security program.

## Handling sensitive data

- Never commit secrets, private keys, tokens, session cookies, or customer data to source control.
- Prefer environment variables or a managed secret store for runtime credentials.
- Store hashed values for API keys and SCIM tokens at rest.
- Redact secret-like keys from any export payloads before returning them to the caller.
- Treat GitHub webhook payloads, audit events, repository metadata, and exported member data as sensitive customer data.

## Core controls in this repository

- Organization-scoped authorization and tenant checks
- GitHub webhook signature verification
- Session-backed per-user access control
- Role-based access control for admin/auditor/owner flows
- Audit event recording for key actions
- Role-specific retention settings and cleanup scheduling

## Security expectations

- All organization-scoped requests must validate the authenticated user against the target organization.
- Secret-bearing configuration must be validated at startup and never silently accepted as empty.
- Production deployments must use TLS, a managed secret manager, and a deployment-specific security review.
- Debug endpoints and admin-only operational routes must be disabled or gated in production.

## Responsible disclosure

Please report suspected vulnerabilities privately to the project maintainers. Include the affected version, reproduction steps, impact assessment, and suggested remediation if known.

Do not disclose a vulnerability publicly before a coordinated remediation window has been agreed.
