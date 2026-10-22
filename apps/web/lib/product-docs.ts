export type DocsStep = {
  title: string;
  body: string;
  href?: string;
  linkText?: string;
};

export type DocsSection =
  | { type: "paragraph"; text: string }
  | { type: "steps"; items: DocsStep[] }
  | { type: "code"; label: string; code: string }
  | { type: "callout"; title: string; text: string; tone?: "note" | "warning" };

export type ProductDoc = {
  slug: string;
  group: string;
  title: string;
  summary: string;
  sections: DocsSection[];
};

export const PRODUCT_DOCS: ProductDoc[] = [
  {
    slug: "assessment",
    group: "Assessments",
    title: "Free AI Risk Assessment",
    summary: "Authorize, scope, run, and interpret a private repository assessment.",
    sections: [
      {
        type: "paragraph",
        text: "An organization owner or administrator selects up to 10 active GitHub or GitLab repositories and authorizes a fixed period ending at assessment creation and starting 30 days earlier. The worker reads pull requests or merge requests updated during that interval and reuses Nomalog's shared analysis pipeline for changed files, risk-v2, organization policy, provenance, findings, evidence, and Change Passports. Provider-specific gaps remain visible in the report.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Connect a source-control provider",
            body: "Connect GitHub through the Nomalog App or GitLab.com through the read-only OAuth connection, then explicitly select the repositories or projects to make available to the organization.",
            href: "/dashboard/repositories",
            linkText: "Review connected repositories",
          },
          {
            title: "Choose assessment scope",
            body: "Open Risk assessment, check only the repositories to include, read the processing disclosure, and acknowledge it to authorize the report. Existing provider authorization is used; installation or OAuth tokens remain server-side and are not stored in the browser.",
            href: "/dashboard/assessment",
            linkText: "Open Risk assessment",
          },
          {
            title: "Review progress and report",
            body: "The report starts with a conclusion and per-area coverage status, followed by selected repositories and dates, risk factors, provider findings and evidence, review/policy coverage, provenance classifications, limitations, and prioritized next steps. No recent pull requests or unavailable scanner data are never presented as a clean result. Reports can be exported as JSON, retried after eligible failures, cancelled between pull requests, or deleted by an organization administrator.",
          },
        ],
      },
      {
        type: "callout",
        title: "What is processed and retained",
        text: "The worker reads pull-request or merge-request metadata, changed-file paths and diff hunks, available review and CI evidence, current repository-wide GitHub Code Scanning, Dependabot, and secret-scanning alert metadata where authorized, and organization policy/provenance/evidence records where available. GitHub alert results are point-in-time open alerts; an empty result does not prove scanner configuration or complete historical coverage. For GitLab, it can collect vulnerability findings only from pipelines matching the analyzed merge-request head, secret-detection reports only from configured successful secret_detection jobs, and exact protected-branch settings. GitLab vulnerability findings require the relevant GitLab permissions (the vulnerability-findings API is Ultimate-tier); inaccessible or unconfigured results are reported as NOT RUN, never clean. An empty vulnerability-finding response is UNKNOWN because it does not prove that a scanner ran. Secret values are removed before findings are persisted. Repository code is not executed. If optional Azure AI code review is enabled, diff hunks may be sent to that configured provider. The assessment report expires after 90 days; an administrator can delete it sooner. Analysis records written to the existing organization evidence store are not deleted with the assessment and follow the workspace's existing retention and deletion processes.",
        tone: "warning",
      },
      {
        type: "callout",
        title: "Coverage and interpretation",
        text: "The window is based on available provider change-request update dates, not a complete event ledger. GitHub collection is bounded to 3,000 pull requests per selected repository; GitLab collection has a 10,000 merge-request pagination safety limit. Reports identify incomplete collections, and the worker fails rather than assigning a potentially understated risk score when GitLab omits or truncates diffs. GitLab approval evidence is not treated as current-head approval because the available response does not bind approvals to the head SHA. GitHub secret scanning reports current open alerts, not alerts historically created during the window. GitLab security reports are limited to successfully retrieved results from current-head pipelines; missing scans, tier restrictions, and permissions remain NOT RUN, while an empty vulnerability-finding result remains UNKNOWN unless scanner execution can be established. Protected-branch evidence evaluates the exact target/default branch; wildcard rules and project-level approval rules are not inferred. Semgrep, Snyk, Sonar, license scans, and broad dependency vulnerability scans are not active integrations here; their absence is shown as NOT RUN or a limitation, never PASS. Provenance percentages use in-window changes as the denominator and classify only recorded evidence; they do not establish that a whole change or repository was AI-generated.",
        tone: "warning",
      },
      {
        type: "paragraph",
        text: "GitHub permissions are granted at installation and GitLab OAuth grants read-only scopes; these connections may serve other Nomalog features. Assessment runs do not publish GitHub Check Runs. To revoke access, uninstall the GitHub App or disconnect/revoke the GitLab connection. Cancelling an assessment stops further work between change requests but does not revoke provider authorization.",
      },
    ],
  },
  {
    slug: "quickstart",
    group: "Start here",
    title: "Quickstart",
    summary: "Create a workspace, connect a repository, and inspect your first change.",
    sections: [
      {
        type: "paragraph",
        text: "Nomalog connects GitHub pull requests to an organization workspace. Start with one test repository so your team can review attribution, risk, policy decisions, human approvals, and evidence before expanding coverage.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Sign in with GitHub",
            body: "Use the GitHub account that will own the workspace. The account needs a verified email address.",
            href: "/api/auth/github/login?redirectTo=/onboarding",
            linkText: "Continue with GitHub",
          },
          {
            title: "Create your organization",
            body: "Choose the organization name used for this workspace. The first account becomes its owner. Organization administrators can provision other members from the Members page; the user signs in with GitHub using that same verified email.",
            href: "/onboarding",
            linkText: "Create an organization",
          },
          {
            title: "Connect a GitHub repository",
            body: "From the workspace, open Repositories and install the GitHub App. A GitHub organization administrator may be required to approve installation and choose repositories.",
            href: "/dashboard/repositories",
            linkText: "Open Repositories",
          },
          {
            title: "Review a pull request",
            body: "Open or update a pull request in the connected repository, then visit Changes and Evidence to review its analysis. For a REVIEW policy decision, assign eligible organization members in the Human review panel and record their decisions there. Nomalog updates the GitHub Check Run for the current commit.",
            href: "/dashboard/changes",
            linkText: "View Changes",
          },
        ],
      },
      {
        type: "callout",
        title: "Test safely first",
        text: "Use a development GitHub App and a repository with non-sensitive test changes while you validate permissions and policy behavior.",
        tone: "warning",
      },
      {
        type: "paragraph",
        text: "The local developer deployment needs extra setup for public GitHub callbacks. Follow the GitHub integration guide before testing installations or webhooks against a self-hosted instance.",
      },
    ],
  },
  {
    slug: "dashboard",
    group: "Dashboard",
    title: "Dashboard guide",
    summary: "What each workspace page shows and how to use it during a rollout.",
    sections: [
      {
        type: "paragraph",
        text: "The workspace dashboard is scoped to the selected organization. Use the organization switcher in the top bar when you belong to more than one organization. The pages summarize persisted organization and pull-request data; they are not a substitute for GitHub's repository settings or code review controls.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Overview",
            body: "Review organization-level counts for AI-attributed and unattributed pull requests, risk, policy outcomes, and Change Passports. The recent changes table links to individual pull-request records. A first-run panel guides you to connect a repository and submit a test PR.",
            href: "/dashboard",
            linkText: "Open Overview",
          },
          {
            title: "Changes and Change Passport",
            body: "Browse analyzed pull requests. Open a change to inspect recorded AI provenance and its supporting signals, risk score and factors, latest policy decision, evidence status, and changed-file classification. For REVIEW decisions, assign eligible members, inspect pending assignments, and record approval, rejection, or a request for changes. Review assignments create an in-app notification and an optional email when email delivery is configured.",
            href: "/dashboard/changes",
            linkText: "Open Changes",
          },
          {
            title: "Findings and remediation",
            body: "Review provider findings, assign an active organization member, set a due date, and track triage, progress, resolution, comments, and status changes. Risk acceptance requires a reason and a future expiry date; reopening the finding revokes its current acceptance record.",
            href: "/dashboard/findings",
            linkText: "Open Findings",
          },
          {
            title: "Governance analytics",
            body: "Choose a 7-, 30-, or 90-day window for pull-request, review-completion, and finding-resolution trends. Current open and overdue finding counts are shown separately from period activity. Review metrics include only decisions recorded after completion timestamps were introduced.",
            href: "/dashboard/analytics",
            linkText: "Open Analytics",
          },
          {
            title: "Repositories",
            body: "Inspect connected repositories and monitoring state. Owners and administrators can start the GitHub App installation or synchronization flow; GitHub controls which repositories the installation is allowed to access.",
            href: "/dashboard/repositories",
            linkText: "Open Repositories",
          },
          {
            title: "AI agents",
            body: "Review aggregate activity from explicit AI-use declarations and recognized agent accounts, along with associated repository, risk, blocked, and review-required counts. Unattributed changes are not proof that AI was or was not used.",
            href: "/dashboard/agents",
            linkText: "Open AI agents",
          },
          {
            title: "Policies",
            body: "Owners and administrators can create organization policies, add rules, choose DRY RUN, ENFORCING, or DISABLED, and enable or disable policies. ENFORCING applies only after the current policy revision receives the organization owner's configured quorum (default two) of independent approvals from active owners or administrators; the author cannot approve. Pending ENFORCING policies remain in DRY RUN, and editing a policy or rule resets its approval count. Built-in platform safeguards remain in effect; when several rules match, the strongest action wins: BLOCK, then REVIEW, then ALLOW.",
            href: "/dashboard/policies",
            linkText: "Open Policies",
          },
          {
            title: "Evidence and checks",
            body: "See evidence records, their source, status, related pull request, timestamp, and provider reason where available. PASS, FAIL, NOT RUN, UNKNOWN, and NOT APPLICABLE are different states; NOT RUN is not a clean scan.",
            href: "/dashboard/evidence",
            linkText: "Open Evidence",
          },
          {
            title: "Notifications",
            body: "The inbox shows review and finding assignments, read state, and email-delivery status. Each member can disable email per organization without disabling in-app notifications. Configure server-only Resend credentials to deliver email; member provisioning does not send invitations.",
            href: "/dashboard/notifications",
            linkText: "Open Notifications",
          },
          {
            title: "Administration",
            body: "Owners and administrators see live summaries of GitHub installation, connected repositories, policy coverage, AI attribution, and evidence coverage. It links to the corresponding configuration pages.",
            href: "/dashboard/admin",
            linkText: "Open Administration",
          },
          {
            title: "Members and roles",
            body: "Organization administrators can provision members, change roles, deactivate or reactivate access, and see each member's most recent sign-in. Member changes and review assignments/decisions are recorded in the organization audit log. Provisioning does not send an email invitation.",
            href: "/dashboard/members",
            linkText: "Open Members",
          },
          {
            title: "Settings",
            body: "Inspect active or removed GitHub installations and the available audit-event list, and sign out. Audit access is role-gated. Member management is on the Members page; SSO and SCIM administration remain API/configuration workflows.",
            href: "/dashboard/settings",
            linkText: "Open Settings",
          },
        ],
      },
      {
        type: "callout",
        title: "Check status follows the approval lifecycle",
        text: "A review-required decision publishes action_required. Nomalog records each assigned review against the current commit and updates the GitHub Check Run when decisions are submitted. A rejection fails the check, a request for changes keeps it action_required, and distinct eligible approvals can complete it successfully. Validate branch-protection behavior in a test repository before enforcing it on production repositories.",
        tone: "note",
      },
    ],
  },
  {
    slug: "members-and-reviews",
    group: "Organization access",
    title: "Members, roles, and human review",
    summary:
      "Provision members, understand role access, and complete policy-required human reviews.",
    sections: [
      {
        type: "paragraph",
        text: "Nomalog includes organization member administration and an in-product review lifecycle. The server checks organization membership and role on every operation; the browser UI is not the authorization boundary.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Provision a member",
            body: "Open Members in the dashboard. An organization ADMIN or OWNER can add a verified email and a role no higher than their own. Nomalog creates or finds the user and activates the organization membership. This does not send an invitation email; the user should sign in to Nomalog through GitHub using that same verified email.",
            href: "/dashboard/members",
            linkText: "Open Members",
          },
          {
            title: "Change role or access",
            body: "From the member roster, update a role, deactivate access, or reactivate a membership. Server-side hierarchy checks prevent grants or management above the acting user's role. The last active OWNER cannot be demoted or deactivated. Deactivation affects only this organization, not the person's account or other memberships.",
          },
          {
            title: "Monitor access",
            body: "The roster shows active/deactivated membership, role, and the most recent sign-in session time. Member add, role change, deactivation/reactivation, review assignment, and review decision actions are audited. Use Settings for the organization audit log. Nomalog does not provide email invitations or an invitation-acceptance tracker.",
            href: "/dashboard/settings",
            linkText: "Open Settings",
          },
          {
            title: "Assign reviewers to a change",
            body: "Open a REVIEW-required change and use its Human review panel. ENGINEER-level members and above can assign active organization members who meet each requirement. The PR author cannot review their own change. Each approval gate requires a different reviewer, and all review records are bound to the current head commit.",
            href: "/dashboard/changes",
            linkText: "Open Changes",
          },
          {
            title: "Record a review decision",
            body: "The assigned reviewer signs in and opens the same change. They can approve, reject, or request changes, with an optional comment. Only the assigned active member can submit that assignment; role eligibility and current commit are checked again by the API. A new commit makes previous approvals stale and requires fresh review assignments.",
          },
        ],
      },
      {
        type: "paragraph",
        text: "Built-in organization roles are OWNER, ADMIN, SECURITY (legacy alias), SECURITY_ADMIN, SECURITY_ANALYST, SENIOR_ENGINEER, PLATFORM_ENGINEER, ENGINEER, REVIEWER, VIEWER, and AUDITOR. The general authorization hierarchy is OWNER > ADMIN > SECURITY_ADMIN > SECURITY_ANALYST > ENGINEER/SENIOR_ENGINEER/PLATFORM_ENGINEER > REVIEWER > AUDITOR > VIEWER. SENIOR_ENGINEER and PLATFORM_ENGINEER have the same general permissions as ENGINEER, but satisfy only their matching specialized review gate. Individual API operations enforce role thresholds on the server.",
      },
      {
        type: "callout",
        title: "How approval labels map to roles",
        text: "SECURITY_REVIEW and SECURITY_ANALYST_REVIEW require SECURITY_ANALYST or higher. SENIOR_ENGINEER_REVIEW requires SENIOR_ENGINEER or an administrator/owner; PLATFORM_REVIEW requires PLATFORM_ENGINEER or an administrator/owner. ENGINEER_REVIEW requires ENGINEER or higher. Reviewer labels require REVIEWER or higher. Each configured gate needs a distinct reviewer. Unknown labels cannot be assigned and must be corrected in the policy.",
        tone: "warning",
      },
      {
        type: "paragraph",
        text: "Nomalog stores decisions in its audit trail and synchronizes the existing GitHub Check Run for the current commit. Rejection changes the check to failure; requesting changes keeps it action_required; all required approvals change it to success. If GitHub is temporarily unavailable, the review remains saved and an authorized engineer can retry check synchronization from the review panel. Exercise this workflow and your branch-protection rules in a disposable repository before enabling ENFORCING mode.",
      },
      {
        type: "paragraph",
        text: "For automated provisioning, an administrator can create an organization-scoped SCIM bearer token through the API and configure an identity provider to call the SCIM v2 Users endpoints. The token is shown only at creation. Current SCIM support covers basic user provisioning, updates, and deactivation with limited group-to-role mappings; complete group lifecycle and SCIM administration UI are not yet available.",
      },
    ],
  },
  {
    slug: "workflow",
    group: "Product",
    title: "How the control plane works",
    summary: "A transparent workflow from pull-request signals to reviewable decisions.",
    sections: [
      {
        type: "paragraph",
        text: "The control plane evaluates changes as GitHub pull-request activity arrives. It gathers signals and presents decisions with their supporting context; it does not replace code review or make an ambiguous signal look certain.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Ingest the change",
            body: "GitHub pull-request events identify the repository, change, and head commit being evaluated.",
          },
          {
            title: "Record AI attribution",
            body: "Explicit declarations and recognized automation identities can provide evidence of AI involvement. Ordinary editor suggestions are not inferred without a visible signal.",
            href: "/docs/ai-attribution",
            linkText: "Understand attribution",
          },
          {
            title: "Assess risk and policy",
            body: "The rules-based risk model and organization policy produce explainable results, including whether human review or a block is required.",
          },
          {
            title: "Aggregate security evidence",
            body: "Configured providers contribute evidence with explicit states. PASS, FAIL, NOT RUN, and UNKNOWN are distinct and should not be conflated.",
            href: "/docs/security-evidence",
            linkText: "Read about evidence",
          },
          {
            title: "Review the Change Passport",
            body: "Inspect the change record, decision rationale, findings, and evidence in the dashboard. Human reviewers remain accountable for approval.",
            href: "/dashboard/changes",
            linkText: "Open Changes",
          },
        ],
      },
      {
        type: "callout",
        title: "Model review is optional",
        text: "The deterministic risk assessment works independently. Azure AI Foundry review is an opt-in provider and is not required for CodeQL or the core workflow.",
      },
    ],
  },
  {
    slug: "ai-attribution",
    group: "Product",
    title: "AI attribution",
    summary: "What the system can and cannot know about AI-assisted changes.",
    sections: [
      {
        type: "paragraph",
        text: "AI involvement is evidence-based. GitHub does not expose whether a person used ordinary inline suggestions from an IDE, so attribution should be treated as a recorded signal rather than an inference about intent.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Declare assistance in the pull request",
            body: "Add an AI-Assisted-By declaration to the PR description. Editing the description triggers a fresh analysis.",
          },
          {
            title: "Or add a commit trailer",
            body: "Put the trailer on its own line in a commit message so it travels with the Git history.",
          },
          {
            title: "Review confidence and source",
            body: "The dashboard records the signal source and confidence where available. When there is no conclusive signal, the result remains Unattributed rather than claiming AI was or was not used.",
          },
        ],
      },
      {
        type: "code",
        label: "Example commit trailer",
        code: "AI-Assisted-By: GitHub Copilot",
      },
      {
        type: "callout",
        title: "Do not treat unknown as no",
        text: "Unattributed means the available GitHub metadata did not establish AI involvement. It is not evidence that no AI tool was used.",
        tone: "warning",
      },
    ],
  },
  {
    slug: "github",
    group: "Integrations",
    title: "GitHub integration",
    summary: "Configure the GitHub App, permissions, callbacks, and webhook events.",
    sections: [
      {
        type: "paragraph",
        text: "The GitHub App links repositories to an organization workspace and delivers pull-request and installation events. Start installation from the Repositories page so the organization context is preserved and access can be checked.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Create a dedicated development GitHub App",
            body: "Set its Homepage URL, user authorization callback, Setup URL, webhook URL, and a unique webhook secret. For a local deployment, use the same stable HTTPS ngrok domain for each public URL.",
          },
          {
            title: "Grant only the required permissions",
            body: "The app needs repository access for the workflows you enable. To read CodeQL status and current Code Scanning alerts, grant Checks: read and Code scanning alerts: read. For current Dependabot alerts, grant Dependabot alerts: read. Approve the updated permissions on the installation; unavailable alerts are reported as unknown or not run, never clean.",
          },
          {
            title: "Subscribe to required events",
            body: "Enable Pull request and Installation webhooks. The integration processes supported pull-request actions and uses installation deletion to disable removed access.",
          },
          {
            title: "Install and select repositories",
            body: "A GitHub organization administrator may need to approve the app. Select only the repositories intended for the workspace and verify the installation in Repositories.",
            href: "/dashboard/repositories",
            linkText: "Open Repositories",
          },
        ],
      },
      {
        type: "callout",
        title: "Single-domain local setup",
        text: "Expose the web app on port 3000. The web host proxies browser API requests and GitHub webhooks to the internal API, so a separate public API tunnel is not needed.",
        tone: "note",
      },
      {
        type: "code",
        label: "Public URLs for a local ngrok deployment",
        code: "APP_URL=https://your-assigned-domain.ngrok-free.app\nNEXT_PUBLIC_API_URL=https://your-assigned-domain.ngrok-free.app/api/backend\nGITHUB_APP_CALLBACK_URL=https://your-assigned-domain.ngrok-free.app/api/auth/github/callback\n\nGitHub Setup URL: https://your-assigned-domain.ngrok-free.app/api/github/installations/callback\nGitHub Webhook URL: https://your-assigned-domain.ngrok-free.app/api/webhooks/github",
      },
      {
        type: "paragraph",
        text: "Replace the example hostname with the exact stable Dev Domain assigned by ngrok. Keep API_INTERNAL_URL=http://api:3001 for service-to-service requests inside Docker Compose. After changing public URLs, rebuild the web app and recreate API/worker containers to load their configuration.",
      },
      {
        type: "paragraph",
        text: "For the production deployment, replace ngrok with a stable HTTPS domain, configure its DNS and TLS, and set the GitHub App callback and webhook URLs to the matching public host. Keep app secrets and private keys out of source control and client-side variables.",
      },
    ],
  },
  {
    slug: "security-evidence",
    group: "Integrations",
    title: "Security evidence",
    summary: "Configure CodeQL and interpret provider results without false assurances.",
    sections: [
      {
        type: "paragraph",
        text: "The GitHub Code Scanning integration reports PASS only after a successful CodeQL check exists for the exact pull-request head commit and no open alerts match that commit. Missing, incomplete, or inaccessible scans are not clean scans.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Enable CodeQL for the repository",
            body: "Use GitHub's CodeQL default setup or a supported workflow, with GitHub Actions enabled and licensing that permits code scanning for the repository.",
          },
          {
            title: "Grant the GitHub App read access",
            body: "Grant Checks: read and Code scanning alerts: read, then accept the changed permissions for the installed GitHub App.",
          },
          {
            title: "Wait for analysis of the current PR head",
            body: "A successful result for an older commit does not count. Push or update the PR, wait for the CodeQL check, then inspect the Evidence view.",
            href: "/dashboard/evidence",
            linkText: "Open Evidence",
          },
        ],
      },
      {
        type: "callout",
        title: "NOT RUN is not PASS",
        text: "Semgrep, Snyk, and Sonar providers are not configured in this deployment. Evidence marked NOT RUN means no completed result is available.",
        tone: "warning",
      },
    ],
  },
  {
    slug: "azure-ai-review",
    group: "Integrations",
    title: "Optional Azure AI review",
    summary: "Enable bounded AI-assisted security review and understand its cost and data flow.",
    sections: [
      {
        type: "paragraph",
        text: "The optional Azure AI Foundry reviewer sends changed-file diff hunks to your configured Azure endpoint and asks the deployed model to identify concrete security vulnerabilities. It is disabled by default and independent of CodeQL.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Create an Azure resource and deploy a model",
            body: "Use a model and region supported by your Azure subscription. A Standard pay-per-token deployment is a practical starting point; confirm current model availability and pricing before deployment.",
          },
          {
            title: "Set server-side worker configuration",
            body: "Set the feature flag, v1 endpoint, API key, and deployment name in the worker's environment. Never expose the key through a NEXT_PUBLIC variable or commit it.",
          },
          {
            title: "Recreate the worker and submit a test PR",
            body: "The worker must load the new environment. Test using a non-sensitive diff, then inspect Azure AI Foundry evidence and manually verify any findings.",
          },
        ],
      },
      {
        type: "code",
        label: "Worker environment (.env)",
        code: "AI_CODE_REVIEW_ENABLED=true\nAZURE_OPENAI_BASE_URL=https://YOUR-RESOURCE.openai.azure.com/openai/v1/\nAZURE_OPENAI_API_KEY=your-server-side-key\nAZURE_OPENAI_MODEL=your-deployment-name",
      },
      {
        type: "callout",
        title: "Usage is not guaranteed to be free",
        text: "Azure model inference can incur charges. Pricing depends on the model and deployment. The review skips unavailable or incomplete diffs and enforces a 50,000-character limit; private code in eligible diffs is sent to your Azure resource.",
        tone: "warning",
      },
    ],
  },
  {
    slug: "data-lifecycle",
    group: "Trust & operations",
    title: "Data handling and lifecycle",
    summary: "Understand current export, retention, and deletion behavior before production use.",
    sections: [
      {
        type: "paragraph",
        text: "Treat repository identifiers, webhook payloads, audit metadata, finding descriptions, member email addresses, and exported organization records as sensitive customer data. Apply your organization's access, storage, and transfer controls to this data.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Organization export",
            body: "Organization administrators can request a JSON export through the organization export API. Credential-like fields are omitted, but the export can still contain sensitive repository and personal data.",
          },
          {
            title: "Configured retention",
            body: "Session retention defaults to 30 days and webhook retention to 90 days. Finalized webhook records support an organization-level retention override; other organization records and audit events are not removed by this cleanup.",
          },
          {
            title: "Review deployment boundaries",
            body: "The current product does not provide an authenticated customer deletion workflow, data residency controls, legal holds, or deletion verification. Azure AI review, when enabled, transmits eligible diffs to the configured Azure resource.",
          },
        ],
      },
      {
        type: "callout",
        title: "Production readiness limitation",
        text: "Do not treat direct database deletion, removal of a Docker volume, or a cleanup helper as a supported customer deletion process. Confirm retention and residency requirements before storing production data.",
        tone: "warning",
      },
    ],
  },
];

export const DOCS_GROUPS = [...new Set(PRODUCT_DOCS.map((doc) => doc.group))].map((group) => ({
  label: group,
  docs: PRODUCT_DOCS.filter((doc) => doc.group === group),
}));

export function getProductDoc(slug: string): ProductDoc | undefined {
  return PRODUCT_DOCS.find((doc) => doc.slug === slug);
}
