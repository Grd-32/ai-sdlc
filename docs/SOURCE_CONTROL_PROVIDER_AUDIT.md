# Source-control and provenance architecture audit

**Audit date:** 2026-10-14  
**Scope:** Repository state before provider-neutral/GitLab implementation.

This audit describes code paths present in the repository. It is not evidence
that a live GitHub, GitLab, Bitbucket, or Azure DevOps account was connected.

## Existing end-to-end GitHub path

1. The API's `/api/webhooks/github` handler validates GitHub's
   `x-hub-signature-256` HMAC using the configured GitHub App webhook secret.
2. `ingestGitHubWebhookDelivery` parses the event, stores its payload and hash,
   and deduplicates by `(provider, deliveryId)`. Replays with the same payload
   are idempotent; a conflicting payload under a reused delivery ID is rejected.
3. Pull-request events resolve an active `GitHubInstallation`, upsert a
   tenant-owned `Repository` and `PullRequest`, record available provenance,
   and enqueue analysis for the supported event actions.
4. The worker validates organization/repository/pull-request ownership, checks
   repository state and entitlements, fetches changed files through the GitHub
   client, and persists file changes and available security evidence.
5. The same worker evaluates risk and organization policy, persists decisions,
   evidence, and a Change Passport, then publishes a GitHub Check Run.

The database-backed worker golden-path test exercises the pipeline with real
PostgreSQL/Redis in the test environment and mocked GitHub network methods. It
does not establish live GitHub API behavior.

## Reusable implementation

- `Repository.provider` and `PullRequest.provider` already identify the
  provider; repository external IDs and pull-request external IDs are retained.
- Shared analysis, risk scoring, policy evaluation, evidence, and Change
  Passport persistence do not inherently require GitHub.
- Assessment lifecycle, persisted reports, tenant-scoped access, repository
  quotas, and usage reservation are existing shared services.
- The existing GitHub client provides examples for pagination, API error
  handling, installation-scoped authentication, pull-request files/reviews,
  branch protection, checks, and security alerts.
- Existing webhook ingestion provides delivery hashing, deduplication, replay
  conflict detection, and retry claiming patterns.
- Existing GitHub OAuth callback and installation routes provide session,
  organization-role, callback-state, audit, and repository-selection patterns.

## Provider-specific coupling and missing abstractions

- `GitHubInstallation` is the only source-control connection model and owns
  repositories through `Repository.githubInstallationId`. There is no generic
  connection record for a GitLab OAuth credential.
- The event table is named `GitHubWebhookEvent`; its `provider` string and
  `(provider, deliveryId)` key are reusable, but ingestion, signature
  verification, and dispatch are GitHub-specific.
- GitHub webhook ingestion and Check Run publishing require an active
  `GitHubInstallation`; the shared worker now supports GitHub and GitLab
  changed-file collection, but its native code-scanning integration remains
  GitHub-specific.
- Historical assessments collect pull requests, reviews, branch protection,
  and secret alerts through provider-specific API functions. GitLab merge
  requests now use the same report, analysis, risk, policy, evidence, and
  Change Passport pipeline, with provider limitations recorded.
- The database's provider fields are strings rather than a shared typed
  capability/connection contract. There is no capability status model to
  distinguish missing evidence, missing permissions, provider limitations,
  provider configuration, or unimplemented functionality.
- Review persistence, CI evidence, branch settings, security findings, and
  evidence are already provider-neutral enough to reuse, but their collection
  currently uses GitHub-specific API data.

## Provenance model and limitations

- `AIActivity` stores `involvement`, `source`, `confidence`, `agent`, optional
  model, repository/change references, timestamp, and free-form JSON metadata.
- `ProvenanceSource` includes declared, agent telemetry, IDE, CI, Git metadata,
  behavioral inference, and unknown categories.
- Current inference recognizes selected GitHub bot identities and explicit
  declaration-like text/trailers. Other unmatched changes remain UNKNOWN.
- A commit trailer and PR text are unverified declarations; recognized bot
  identity is an observed provider signal, not proof of complete AI authorship.
- The schema does not have a first-class signal registry, verification status,
  or immutable source-reference model. Confidence is numeric but not tied to a
  documented calibration method.
- Assessment reporting already avoids claiming universal AI detection and
  explains that its denominator is pull requests with activity in the selected
  window. It still depends on the latest persisted `AIActivity` record and
  should be upgraded to expose individual signal sources and verification.

## Security, migration, and testing notes

- GitHub installation tokens are minted server-side and cached in memory; the
  GitHub App private key is supplied via server environment configuration.
- No reusable credential encryption-at-rest service exists for third-party
  OAuth refresh/access tokens. GitHub installation webhook secrets have a
  plaintext database field, although the current application validates with a
  configured app-level secret.
- Tenant isolation is enforced at worker and API boundaries and covered by
  database-backed tests. A new provider connection must use these same
  organization checks; provider IDs alone are not tenant authorization.
- Webhook JSON is persisted for idempotency/operations. Provider-specific
  payload retention and source-code redaction should be reviewed before
  storing additional event bodies.
- Existing test coverage includes API webhook replay/conflict tests, database
  tenancy tests, API installation lifecycle tests, worker analysis
  mode/assessment tests, and the database-backed golden path. There are no
  GitLab contract or live-provider tests in this baseline.
- The migration history has prior additive and repair migrations. Provider
  schema work should be additive, preserve existing GitHub rows, and must not
  reset the existing database.

## Provider baseline

| Provider        | Authentication                        | Discovery / change data           | Webhooks                                      | Shared analysis                             |
| --------------- | ------------------------------------- | --------------------------------- | --------------------------------------------- | ------------------------------------------- |
| GitHub          | Implemented with GitHub App and OAuth | Implemented for current workflows | Implemented with HMAC, delivery deduplication | Implemented; GitHub client remains required |
| GitLab.com      | Not implemented at audit baseline     | Not implemented                   | Not implemented                               | No adapter                                  |
| Bitbucket Cloud | Not implemented                       | Not implemented                   | Not implemented                               | No adapter                                  |
| Azure DevOps    | Not implemented                       | Not implemented                   | Not implemented                               | No adapter                                  |

The current audit found no production adapter for Bitbucket Cloud or Azure
DevOps. Their API capability mapping and implementation plan must be kept
separate from any claim of support.

## Implementation status after the baseline audit

The following foundation has since been added; it does not supersede the
GitHub-only pipeline limitations above:

- `@ai-sdlc/source-control` defines normalized repository, change-request,
  changed-file, review, pipeline, evidence-reference, provider-error, and
  capability-status contracts.
- A GitLab.com-only client implements user lookup, membership-visible project
  listing, time-bounded merge-request listing, changed-file diffs, approval
  evidence, and pipeline status. API hosts are fixed to `gitlab.com`; arbitrary
  self-managed hosts are not accepted.
- GitLab OAuth authorization-code exchange uses PKCE. Access and refresh
  credentials are encrypted with AES-256-GCM using the server-only
  `SOURCE_CONTROL_ENCRYPTION_KEY`.
- API routes enforce organization admin access for connect, selection, and
  disconnect; repository discovery checks the selected connection's
  organization; project selection is explicit; repository quotas are
  transactionally guarded; disconnect disables linked repositories and
  attempts remote token revocation.
- The Repositories UI can connect GitLab.com, discover projects, select them,
  disconnect, and rotate a one-time webhook secret. The API authenticates
  merge-request webhook deliveries, deduplicates provider delivery UUIDs,
  restricts events to projects linked to the issuing connection, and protects
  against stale deliveries. External GitLab webhook configuration is manual
  and has not been live-tested.
- Unit tests cover provider normalization/pagination/errors/capability states,
  OAuth exchange/refresh/revocation request handling, and credential
  encryption. No live GitLab credentials or account have been tested.

| Provider / capability                                 | Current verified state                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub                                                | Existing installation, webhook, analysis, assessment, and Check Run path; tested in the existing application suite                                                                                                                                                                                                                                                                                                                                |
| GitLab.com OAuth and project discovery                | Implemented; automated client tests pass; live OAuth remains external-configuration dependent                                                                                                                                                                                                                                                                                                                                                     |
| GitLab.com merge-request discovery, diff and analysis | Selected projects can be assessed with the shared analysis, risk, policy, evidence, and Change Passport pipeline; incomplete diffs fail rather than producing a potentially understated size risk                                                                                                                                                                                                                                                 |
| GitLab.com approvals and CI pipelines                 | Approval evidence is stored as UNKNOWN for current-head linkage; pipeline statuses are persisted, and no pipeline/ambiguous status is not treated as a pass                                                                                                                                                                                                                                                                                       |
| GitLab.com selection and disconnect                   | Tenant-scoped API/UI routes implemented; additive migrations are applied locally with no schema drift; production deployment and live-provider behavior remain unverified                                                                                                                                                                                                                                                                         |
| GitLab.com merge-request webhooks                     | Implemented for authenticated, linked projects; manual external setup and live delivery testing remain                                                                                                                                                                                                                                                                                                                                            |
| GitLab.com complete continuous repository monitoring  | Not implemented; only configured merge-request events enter webhook-triggered analysis                                                                                                                                                                                                                                                                                                                                                            |
| GitLab.com vulnerability findings                     | Pipeline-scoped reads implemented for pipelines matching the analyzed merge-request head; an empty findings response is `UNKNOWN` because it does not prove a scanner ran. GitLab documents this API as Ultimate-tier and unstable/deprecated in favor of GraphQL, so API evolution and permissions remain operational risks                                                                                                                      |
| GitLab.com secret detection                           | Configured successful `secret_detection` pipeline report artifacts are read and normalized; raw secret values are excluded. No scan or inaccessible artifact is `NOT_RUN`, not a clean result. Artifact redirects are restricted to HTTPS GitLab/object-storage hosts and do not receive the GitLab token                                                                                                                                         |
| GitLab.com protected branches                         | Protected-branch settings are collected; exact target/default branch protection and force-push are evaluated. Wildcard inheritance and approval rules are not inferred                                                                                                                                                                                                                                                                            |
| GitLab self-managed                                   | Not supported; fixed provider host is an intentional SSRF boundary                                                                                                                                                                                                                                                                                                                                                                                |
| Bitbucket Cloud                                       | OAuth connection, encrypted credential storage, account/workspace/repository discovery, tenant-scoped explicit selection, quota enforcement, token refresh, disconnect, and dashboard onboarding are implemented with mocked tests. Complete unified diffs feed 30-day assessment and on-demand analysis; live account verification remains outstanding                                                                                           |
| Azure DevOps                                          | Microsoft Entra OAuth with PKCE, encrypted credential storage, organization/project/repository discovery, tenant-scoped explicit selection, quota enforcement, token refresh, disconnect, and dashboard onboarding are implemented with mocked tests. Current-iteration text diffs and optional `vso.advsec` Advanced Security active alerts enter 30-day assessment and shared on-demand analysis; live account verification remains outstanding |

## Bitbucket Cloud and Azure DevOps readiness and remaining work

The application now supports administrator-authorized connections and
repository selection for both providers. Connection records use the shared
encrypted credential envelope. The backend re-verifies a selected connection,
workspace/project, and every repository ID with the provider before persisting
the selection, and serializes repository quota checks per organization.
Bitbucket tokens are revoked remotely on disconnect when the provider accepts
the request; Azure DevOps access is disabled locally and the user must revoke
the Entra consent grant in account settings. These are mocked contract and API
tests, not live provider verification.

| Capability                   | Bitbucket Cloud                                                                                                                                                                                                                                                                                                                                                                                | Azure DevOps                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication               | OAuth callback, account verification, encrypted persistence, refresh, Bitbucket revocation, and admin-only disconnect are implemented; live OAuth and remote revocation remain unverified.                                                                                                                                                                                                     | Microsoft Entra callback uses PKCE; encrypted persistence, refresh, and local admin-only disconnect are implemented. Users must revoke the Entra consent grant themselves. Azure DevOps legacy OAuth registrations are deprecated and must not be used for new integrations.                                                                                                                                                                        |
| Repository discovery         | Application verifies the OAuth account, discovers visible workspaces, fetches repositories only for the selected workspace, and re-verifies selections before persistence.                                                                                                                                                                                                                     | Application binds the connection to the organization slug, verifies visible projects, fetches repositories only for an authorized project, and re-verifies selections before persistence.                                                                                                                                                                                                                                                           |
| Commit metadata              | Implemented: pull-request commits are paginated within provider-host boundaries, validated, bounded to 10,000 commits, and normalized with commit ID, message, author name, timestamp, and provider evidence reference. Shared analysis persists records idempotently by repository and SHA. Mocked fixtures cover normalization, malformed responses, permission denial, and network failure. | Implemented: pull-request commits use the Azure DevOps Git Commits API and continuation-token pagination, are validated and bounded to 10,000 commits, then normalized and persisted idempotently by repository and SHA during shared analysis. Mocked fixtures cover pagination, malformed responses, permission denial, and network failure.                                                                                                      |
| Pull-request metadata        | Adapter normalizes pull-request state, refs, actor, timestamps, and source commit; 30-day updated-time collection is wired into assessment.                                                                                                                                                                                                                                                    | Adapter normalizes pull-request state, refs, actor, creation timestamp, and last merge source commit; creation-time window query and incomplete activity history are documented. Wired into 30-day assessment using that provider query.                                                                                                                                                                                                            |
| Changed files and diffs      | Complete diffstat and unified patch content are collected with a 5 MiB safety limit and exact changed-file completeness check; wired to shared on-demand analysis.                                                                                                                                                                                                                             | Latest iteration changes are fetched and text hunks generated by comparing common-base and source-commit file content; 200-file, 5 MiB aggregate-payload, and diff-complexity limits fail explicitly. Unsupported change types and binary files produce incomplete analysis rather than a false zero-diff result. Wired into shared analysis and 30-day assessment.                                                                                 |
| Security alerts              | Native secret scanning remains unavailable.                                                                                                                                                                                                                                                                                                                                                    | Microsoft Advanced Security alerts are collected from the provider's active-alert endpoint with `vso.advsec`; code, dependency, and secret alert types are represented in assessment reports and the shared evidence pipeline. Secret alert titles are redacted to a generic label and secret values are not persisted. Missing scope/permission is NOT_RUN. Empty results are UNKNOWN because scanner enablement and coverage are not established. |
| Review and approval evidence | Participant approval state is persisted as UNKNOWN; without approval timestamp or matching commit SHA, current-head approval coverage is not claimed.                                                                                                                                                                                                                                          | Adapter reads reviewer votes; it does not bind them to a time/current PR iteration.                                                                                                                                                                                                                                                                                                                                                                 |
| CI/CD results                | Current-head-matched pipeline statuses are mapped to evidence; absent, incomplete, and non-terminal results are UNKNOWN or NOT_RUN.                                                                                                                                                                                                                                                            | PR status records are persisted as UNKNOWN evidence because they do not provide a complete pipeline inventory or verified current-head SHA.                                                                                                                                                                                                                                                                                                         |
| Webhooks                     | Admin-only secret setup and signed HMAC delivery are implemented. Deliveries are scoped to the active connection and selected repository, deduplicated by request UUID, stale updates are rejected, and supported pull-request events enter shared analysis. Manual setup and live delivery remain unverified; this is not continuous repository monitoring.                                   | Admin-only Basic-auth credential setup and Azure DevOps Web Hook delivery are implemented. Deliveries are scoped to the active connection and selected repository, deduplicated by event UUID, stale updates are rejected, and pull-request created/updated events enter shared analysis. Manual setup and live delivery remain unverified; this is not continuous repository monitoring.                                                           |
| Policy enforcement           | Branch-restriction configurations are collected during assessment and analysis, but no effective-protection result is claimed; rule semantics and enforcement remain unverified.                                                                                                                                                                                                               | Exact-scope policy configuration is collected and persisted as UNKNOWN evidence; policy semantics/enforcement and wildcard inheritance are not evaluated.                                                                                                                                                                                                                                                                                           |
| Change Passport evidence     | Shared on-demand and webhook-triggered analysis persists code changes, risk, policy, findings, and evidence. Native secret scanning is NOT_RUN; branch restriction configuration is persisted as UNKNOWN, not effective enforcement; no continuous repository monitoring.                                                                                                                      | Shared on-demand, Service Hook-triggered analysis, and assessment persist diffs, risk, policy, review/status evidence, findings, and Change Passports. Advanced Security alert evidence is available only with `vso.advsec`; Service Hooks do not provide complete continuous monitoring.                                                                                                                                                           |

Provider-specific API references:

- [Bitbucket Cloud REST API 2.0](https://developer.atlassian.com/cloud/bitbucket/rest/intro/)
- [Bitbucket Cloud pull requests API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/)
- [Azure DevOps Git repositories REST API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories?view=azure-devops-rest-7.1)
- [Azure DevOps pull requests REST API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests?view=azure-devops-rest-7.1)
- [Azure DevOps pull-request iterations REST API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iterations/get?view=azure-devops-rest-7.1)
- [Azure DevOps pull-request iteration changes REST API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iteration-changes/get?view=azure-devops-rest-7.1)
- [Azure DevOps items REST API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/get?view=azure-devops-rest-7.1)
- [Azure DevOps Advanced Security alerts REST API 7.2](https://learn.microsoft.com/en-us/rest/api/azure/devops/advancedsecurity/alerts/list?view=azure-devops-rest-7.2)
- [Azure DevOps Service Hooks overview](https://learn.microsoft.com/en-us/azure/devops/service-hooks/overview?view=azure-devops)
- [Azure DevOps Web Hooks consumer](https://learn.microsoft.com/en-us/azure/devops/service-hooks/services/webhooks?view=azure-devops)
- [Azure DevOps Service Hook events](https://learn.microsoft.com/en-us/azure/devops/service-hooks/events?view=azure-devops)

The Azure DevOps API references were checked against Microsoft Learn. The
Atlassian documentation endpoints were unavailable to the documentation
fetcher during this update. Bitbucket HMAC delivery is covered by mocked tests,
but its exact provider behavior and a live delivery remain unverified.

1. **Bitbucket Cloud:** verify manual webhook setup and delivery against a
   disposable workspace/repository; confirm the provider's signature and event
   headers. Bitbucket Data Center is a separate product/host and is out of scope.
2. **Azure DevOps:** verify Service Hook Basic authentication, pull-request
   payload shape, and retry behavior against a disposable project. Also verify
   Microsoft Entra `vso.advsec` consent, active-alert permissions, and diff
   behavior in a disposable organization. Neither provider has live integration
   verification in this implementation.

Incoming GitHub pull-request events now upsert a first-class current
provenance signal alongside the existing `AIActivity` record. Explicit
pull-request declarations remain `DECLARED`/`UNVERIFIED`; recognized bot
authors are `OBSERVED`/`VERIFIED` with a limitation that this does not prove
full AI authorship; unmatched evidence remains `UNKNOWN`. The assessment
report aggregates the latest persisted signal for each selected change request
and counts absent signals as `UNKNOWN`. GitLab does not yet ingest provenance
signals from webhooks or other provider events. Do not treat a GitLab provider
connection as proof that changes have AI provenance evidence.

Bitbucket and Azure DevOps pull-request commit metadata is now collected during
shared analysis and upserted by repository/SHA. The source-control adapter
tests cover successful normalization, continuation behavior, and malformed
provider payloads. Cross-organization assessment-report access is covered by
the database-backed tenant-isolation test; that test still requires the
configured local database to run.
