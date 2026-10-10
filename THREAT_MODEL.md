# Threat Model

## Assets

- organization and user identity records
- repository and pull-request metadata
- policy and decision history
- GitHub app credentials and webhook secrets
- AI provenance and change passport data
- audit and observability records
- retention and export flows for customer data

## Trust boundaries

- Browser/API client boundary
- authenticated session boundary
- organization and role enforcement boundary
- database and Redis boundary
- GitHub webhook integration boundary
- worker queue processing boundary

## Threats considered

- unauthorized cross-tenant access to organization data
- forged or replayed webhook deliveries
- secret leakage through logs or exports
- privilege escalation through role or membership bugs
- stale or unbounded retention causing privacy exposure
- operator misuse of admin-only endpoints
- unvalidated or malformed request bodies

## Existing mitigations

- tenant-scoped queries and middleware checks
- GitHub signature verification before webhook acceptance
- membership checks before organization reads or writes
- hashing for API keys and SCIM bearer tokens
- retention cleanup scheduling for expired sessions and finalized webhooks
- auditable exports and audit event recording for administrative operations

## Residual risks

- production deployment is not yet hardened with a managed KMS or external secret manager
- rate limiting and input validation are still partial and should be added before broader production traffic
- multi-region residency and customer deletion workflows require formal operational controls
- real security provider integrations and live incident response workflows are still future work

## Security principles

1. Minimum privilege for every role and service account
2. Defense in depth across API, queue, and data boundaries
3. Auditability of all administrative and policy actions
4. Data minimization and retention enforcement
5. Explicit handling of customer privacy and residency obligations
