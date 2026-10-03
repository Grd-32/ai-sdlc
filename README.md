# AI-SDLC Control Plane

> **Vendor-neutral, privacy-preserving security and governance infrastructure for AI-assisted software development.**

## 1. Product Overview

AI-SDLC Control Plane is a security and governance platform designed for organizations whose engineering teams increasingly use AI coding assistants and autonomous coding agents.

The product does **not** exist primarily to replace SAST, SCA, secret scanning, code review, CI/CD, or existing AppSec products. Instead, it sits above and across those systems to provide a unified layer for:

- AI/agent provenance
- AI-assisted change visibility
- sensitive-code classification
- context-aware risk assessment
- policy enforcement
- security evidence aggregation
- human approval requirements
- auditability
- AI Change Passports
- privacy-preserving AI development governance

### Core promise

> **Know what your AI agents did, control what they are allowed to do, verify the software they produce, and prove that every AI-assisted change met your organization's security policy.**

### Core product thesis

Organizations are rapidly adopting AI coding tools, but software security and governance workflows were not designed around autonomous agents.

The problem is not simply:

> "AI writes insecure code."

The larger problem is:

> **Organizations cannot reliably prove what AI did inside their software-development lifecycle, whether it operated within policy, and whether the resulting change was adequately verified before reaching production.**

AI-SDLC Control Plane addresses that accountability and control gap.

---

# 2. Strategic Positioning

## 2.1 What this product is

AI-SDLC Control Plane is a **vendor-neutral AI development security and governance control plane**.

It correlates:

```text
AI agents
   +
developers
   +
repositories
   +
commits
   +
pull requests
   +
changed files
   +
sensitive code areas
   +
security findings
   +
CI/CD results
   +
human reviews
   +
organizational policies
   +
deployment evidence
```

into a unified security record.

## 2.2 What this product is NOT

Do not turn this project into:

- a generic AI code scanner
- a generic AI PR reviewer
- an AI-generated-code detector
- a GitHub-only security product
- an employee-surveillance platform
- a replacement for Snyk, Semgrep, CodeQL, Sonar, etc.
- a generic AI agent firewall
- an LLM wrapper that simply asks a model whether code is secure

Existing security tools should be treated as integrations and evidence sources where appropriate.

## 2.3 Long-term positioning

The long-term product should become:

> **The security control plane for the agentic software development lifecycle.**

Potentially:

```text
Claude Code
Codex
Cursor
Copilot
Gemini
Windsurf
OpenHands
Internal coding agents
        |
        v
+---------------------------+
| AI-SDLC CONTROL PLANE     |
|                           |
| Provenance                |
| Agent identity            |
| Risk                      |
| Policy                    |
| Evidence                  |
| Governance                |
+-------------+-------------+
              |
     +--------+--------+
     |        |        |
   GitHub   GitLab   Other SCM
     |
     v
   CI/CD
     |
     v
 Production
```

---

# 3. Problem Statement

Modern engineering organizations increasingly allow AI systems to:

- read repositories
- modify source code
- create commits
- create pull requests
- install packages
- execute tests
- run shell commands
- access MCP servers
- interact with external services
- modify infrastructure
- autonomously fix issues
- potentially participate in deployment workflows

This creates a new software supply-chain participant:

```text
AI Agent
    |
    +--> tools
    +--> permissions
    +--> context
    +--> source code
    +--> dependencies
    +--> CI/CD
    +--> external systems
```

Traditional AppSec tools primarily answer:

> "Is this code vulnerable?"

AI-SDLC Control Plane must answer broader questions:

- Was AI involved?
- Which AI agent was involved?
- How confident are we?
- What did it change?
- Which sensitive areas did it affect?
- What could the agent access?
- Which policies applied?
- Which security controls ran?
- Did those controls pass?
- Was human review required?
- Did the required people approve?
- Was the change blocked, approved, or allowed?
- Can the organization prove all of this later?

---

# 4. Product Principles

## 4.1 Vendor neutral

Do not architect around one AI provider.

The platform must eventually support:

- Claude Code
- OpenAI Codex
- GitHub Copilot
- Cursor
- Gemini
- Windsurf
- OpenHands
- custom/internal coding agents
- future agents

Likewise, source control must eventually support:

- GitHub
- GitLab
- Bitbucket
- Azure DevOps

## 4.2 Privacy by design

The product should collect the minimum data required to establish security evidence.

Prefer storing:

```text
metadata
hashes
classifications
risk scores
policy decisions
security findings
review records
timestamps
agent identity
confidence
```

instead of permanently storing:

```text
full prompts
entire AI conversations
entire source repositories
unnecessary developer activity
customer data
secrets
```

The platform should support a future architecture in which code analysis can occur locally or in the customer's environment and only minimized telemetry is sent to the cloud.

## 4.3 Explainability

Security decisions must be explainable.

Do not make:

```text
LLM says risk = 87
```

the primary decision mechanism.

Instead:

```text
Risk: 87 / 100

Reasons:
+30 Payment subsystem
+25 Authorization logic
+20 AI involvement
+10 Critical repository
+10 New dependency
-5 Tests passed
-3 SAST passed
```

LLMs may assist with classification or contextual reasoning, but the final policy and risk decisions should be deterministic and auditable whenever possible.

## 4.4 Least privilege

The product itself must follow least privilege.

This applies to:

- GitHub permissions
- API access
- database access
- workers
- cloud infrastructure
- customer data
- secrets
- internal services

## 4.5 Multi-tenancy from day one

All organization-owned resources must be tenant scoped.

Important entities should have:

```text
organizationId
```

and all service-layer access must enforce tenant boundaries.

## 4.6 Evidence first

The platform is not merely a dashboard.

Its core purpose is to create trustworthy security evidence.

The dashboard is a projection of that evidence.

---

# 5. Target Customers

Initial Ideal Customer Profile:

- 100–2,000 employees
- approximately 20–500 developers
- software-centric company
- GitHub or GitLab
- multiple AI coding tools
- active CI/CD
- dedicated security/AppSec/DevSecOps function
- meaningful application security requirements
- commercially sensitive or regulated software

Strong initial verticals:

- fintech
- SaaS
- healthtech
- insurtech
- B2B platforms
- technology consultancies
- software companies handling sensitive customer information

Do not optimize the MVP around giant banks or government organizations initially. Enterprise sales cycles and deployment requirements can be addressed later.

---

# 6. Buyer Personas

Primary:

- CISO
- Head of Application Security
- Head of Product Security

Secondary:

- CTO
- VP Engineering
- Head of DevSecOps
- Security Engineering
- Platform Engineering
- GRC / Compliance

Developers are not the primary economic buyer, but they are critical users.

The product must avoid creating unnecessary developer friction.

---

# 7. Buyer Problem

The product should ultimately communicate this problem:

> "Your engineering organization is using multiple AI coding agents, but your security team cannot reliably determine what AI changed, what those agents could access, which policies applied, which security controls ran, or whether high-risk changes received the required verification before production."

The product response:

> **"We create a verifiable security record for every AI-assisted software change."**

---

# 8. Core Product Model

The core relationship is:

```text
Organization
    |
    +--- Users
    |
    +--- AI Agents
    |
    +--- Repositories
    |       |
    |       +--- Commits
    |       |
    |       +--- Pull Requests
    |               |
    |               +--- Code Changes
    |                       |
    |                       +--- AI Activity
    |                       +--- Risk Assessment
    |                       +--- Security Findings
    |                       +--- Policy Decisions
    |                       +--- Reviews
    |                       +--- Evidence
    |                       +--- Change Passport
    |
    +--- Policies
    |
    +--- Security Integrations
    |
    +--- Audit Events
```

The AI activity chain is:

```text
AI Agent
   |
   v
AI Session
   |
   v
AI Activity
   |
   v
Code Change
   |
   v
Commit
   |
   v
Pull Request
   |
   v
Security Evidence
   |
   v
Policy Decision
   |
   v
Human Approval
   |
   v
Deployment
```

---

# 9. High-Level Architecture

```text
                         +------------------+
                         |      GitHub      |
                         | GitHub App/Webhook|
                         +--------+---------+
                                  |
                                  v
                    +--------------------------+
                    |       API Gateway        |
                    |       Hono / Node        |
                    +------------+-------------+
                                 |
                +----------------+----------------+
                |                |                |
                v                v                v
         Event Processor    Policy Engine     Auth/RBAC
                |
                v
           Job Queue
        Redis + BullMQ
                |
       +--------+---------+----------------+
       |        |         |                |
       v        v         v                v
  Provenance  Change   Security      Integration
   Engine    Analyzer   Analyzer       Workers
       |        |         |                |
       +--------+---------+----------------+
                         |
                         v
                   Risk Engine
                         |
                         v
                  Evidence Builder
                         |
                         v
                  Change Passport
                         |
                 +-------+-------+
                 |               |
                 v               v
             Dashboard       GitHub PR
```

---

# 10. Technology Stack

Use technologies already familiar to the team where possible.

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui

## Backend

- Hono
- TypeScript
- Node.js

## Database

- PostgreSQL
- Prisma

## Queue

- Redis
- BullMQ

## Authentication

MVP:

- GitHub OAuth
- GitHub App installation

Future:

- SSO
- SAML
- OIDC
- enterprise identity providers

## Deployment

Initial development/deployment:

- Docker
- Docker Compose

Future:

- Kubernetes
- managed PostgreSQL
- managed Redis
- private/VPC deployment
- self-hosted enterprise deployment

## Package manager

Use:

- pnpm
- pnpm workspaces

---

# 11. Monorepo Structure

Recommended structure:

```text
ai-sdlc/
|
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── ...
│   │
│   ├── api/
│   │   ├── routes/
│   │   ├── middleware/
│   │   ├── services/
│   │   └── index.ts
│   │
│   └── worker/
│       ├── jobs/
│       ├── processors/
│       └── index.ts
│
├── packages/
│   ├── db/
│   │   ├── prisma/
│   │   ├── migrations/
│   │   └── client.ts
│   │
│   ├── github/
│   │   ├── app.ts
│   │   ├── client.ts
│   │   └── webhooks.ts
│   │
│   ├── provenance/
│   │   ├── detector.ts
│   │   ├── classifiers.ts
│   │   └── models.ts
│   │
│   ├── risk/
│   │   ├── scorer.ts
│   │   ├── rules.ts
│   │   └── classifiers.ts
│   │
│   ├── policy/
│   │   ├── engine.ts
│   │   ├── rules.ts
│   │   └── evaluator.ts
│   │
│   └── security/
│       ├── findings.ts
│       ├── providers.ts
│       └── integrations/
│
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

This structure can evolve, but domain logic should be kept out of individual route handlers wherever practical.

---

# 12. Core Services

## 12.1 Web Application

Responsibilities:

- authentication
- organization selection
- dashboard
- repository management
- AI agent visibility
- policy management
- change history
- evidence views
- Change Passport rendering
- administrative settings

The web app should not contain business logic that belongs in the API/domain layer.

## 12.2 API

Responsibilities:

- authentication
- organization management
- GitHub installation management
- repositories
- policies
- dashboard data
- evidence queries
- Change Passport queries
- webhook intake
- admin actions

## 12.3 Worker

Responsibilities:

- asynchronous PR analysis
- AI attribution
- file classification
- risk calculation
- policy evaluation
- security integration processing
- evidence aggregation
- Change Passport generation
- GitHub status/check updates

Never perform expensive analysis synchronously inside webhook handlers.

## 12.4 Database Package

Centralize:

- Prisma client
- schema
- migrations
- common database helpers
- tenant-scoping helpers

## 12.5 GitHub Package

Centralize:

- GitHub App authentication
- installation tokens
- repository access
- PR access
- webhook parsing
- webhook signature verification
- GitHub Check Runs
- PR comments/statuses

## 12.6 Provenance Package

Responsible for:

- AI involvement detection
- AI agent identification
- confidence scores
- provenance sources
- attribution evidence

## 12.7 Risk Package

Responsible for:

- sensitive-area classification
- repository criticality
- risk factors
- risk scoring
- risk explanations

## 12.8 Policy Package

Responsible for:

- policy definitions
- rule evaluation
- required approvals
- ALLOW / REVIEW / BLOCK decisions

## 12.9 Security Package

Responsible for:

- normalized security findings
- SAST integration
- SCA integration
- secret scanning integration
- CI evidence
- future DAST/container/IaC signals

---

# 13. Core Domain Entities

Initial domain entities:

```text
Organization
User
OrganizationMember
GitHubInstallation
Repository
PullRequest
Commit
AIActivity
CodeChange
SecurityFinding
RiskAssessment
Policy
PolicyRule
PolicyDecision
Review
Evidence
ChangePassport
AuditEvent
```

Do not implement all of these simultaneously. The model should support the eventual domain, while implementation proceeds incrementally.

---

# 14. Organization

Represents a customer tenant.

Expected fields:

```text
id
name
slug
createdAt
updatedAt
```

Potential future fields:

```text
plan
dataRetentionPolicy
securitySettings
deploymentMode
```

All tenant-owned resources must be associated with an organization.

---

# 15. User

Represents a person who can access the platform.

Initial fields:

```text
id
githubUserId
username
email
name
avatarUrl
createdAt
updatedAt
```

Do not store more personal data than needed.

---

# 16. OrganizationMember

Represents user membership and authorization.

Example roles:

```text
OWNER
ADMIN
SECURITY
ENGINEER
VIEWER
AUDITOR
```

Role-based access control must be enforced server-side.

---

# 17. GitHubInstallation

Represents the installation of the GitHub App into a GitHub organization/account.

Conceptual fields:

```text
id
organizationId
githubInstallationId
accountLogin
accountType
permissions
createdAt
updatedAt
```

Sensitive GitHub App credentials must not be stored as plaintext in ordinary database columns.

---

# 18. Repository

Represents a monitored source repository.

Conceptual fields:

```text
id
organizationId
githubInstallationId
githubRepositoryId
name
fullName
defaultBranch
private
criticality
monitoringEnabled
createdAt
updatedAt
```

Criticality should eventually be configurable:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

---

# 19. PullRequest

Represents a pull request being analyzed.

Conceptual fields:

```text
id
organizationId
repositoryId
githubPullRequestId
number
title
author
sourceBranch
targetBranch
state
openedAt
closedAt
mergedAt
createdAt
updatedAt
```

---

# 20. Commit

Represents a commit associated with a PR or repository.

Conceptual fields:

```text
id
organizationId
repositoryId
pullRequestId
sha
author
committer
message
timestamp
```

---

# 21. AIActivity

Represents evidence that an AI system participated in a development activity.

Important: **AI attribution is probabilistic unless directly verified.**

Conceptual fields:

```text
id
organizationId
repositoryId
pullRequestId
agentType
agentName
modelName
source
confidence
startedAt
endedAt
metadata
createdAt
```

Possible provenance sources:

```text
DEVELOPER_DECLARED
AGENT_TELEMETRY
GIT_METADATA
IDE_SIGNAL
BEHAVIORAL_INFERENCE
CI_SIGNAL
INTEGRATION_SIGNAL
UNKNOWN
```

Example:

```json
{
  "agentType": "coding_agent",
  "agentName": "claude-code",
  "modelName": "claude-sonnet",
  "source": "developer_declared",
  "confidence": 1.0
}
```

Or:

```json
{
  "agentName": "unknown",
  "source": "behavioral_inference",
  "confidence": 0.61
}
```

Never present inferred attribution as absolute truth.

---

# 22. CodeChange

Represents the semantic/security characteristics of a code change.

Conceptual fields:

```text
id
organizationId
repositoryId
pullRequestId
commitSha
filesChanged
linesAdded
linesDeleted
changeType
sensitiveAreas
aiActivityId
riskScore
riskLevel
createdAt
updatedAt
```

---

# 23. Sensitive Areas

Initial controlled vocabulary:

```text
AUTHENTICATION
AUTHORIZATION
PAYMENTS
CRYPTOGRAPHY
SECRETS
DATABASE
PERSONAL_DATA
INFRASTRUCTURE
NETWORKING
API
DEPENDENCIES
CI_CD
CONTAINERS
LOGGING
FRONTEND
TESTING
DOCUMENTATION
```

This classifier is expected to become more sophisticated over time.

---

# 24. SecurityFinding

Normalizes findings from security systems.

Conceptual fields:

```text
id
organizationId
repositoryId
pullRequestId
provider
providerFindingId
category
severity
title
description
file
line
ruleId
status
metadata
createdAt
updatedAt
```

Possible categories:

```text
SAST
SCA
SECRET
DAST
CONTAINER
IAC
MALICIOUS_DEPENDENCY
AI_SECURITY
OTHER
```

Possible severity:

```text
INFO
LOW
MEDIUM
HIGH
CRITICAL
```

---

# 25. RiskAssessment

Represents the risk decision for a change.

Conceptual fields:

```text
id
organizationId
codeChangeId
score
level
factors
explanation
version
createdAt
```

The `version` field is important because risk models will evolve. Historical assessments must remain reproducible.

---

# 26. Policy

Represents an organization-level security policy.

Conceptual fields:

```text
id
organizationId
name
description
enabled
priority
createdAt
updatedAt
```

---

# 27. PolicyRule

Represents individual conditions/actions.

Example conceptual structure:

```text
id
policyId
conditions
requirements
action
priority
```

Example policy:

```yaml
name: AI Payment Protection

when:
  ai_involved: true
  sensitive_area:
    - payments

require:
  - security_review
  - senior_engineer_review

action: review
```

Another:

```yaml
name: AI Secret Protection

when:
  ai_involved: true
  sensitive_area:
    - secrets

action: block
```

The YAML representation is a future interface, not necessarily the initial storage format.

---

# 28. PolicyDecision

Represents the policy engine's output.

Possible actions:

```text
ALLOW
REVIEW
BLOCK
```

Conceptual fields:

```text
id
organizationId
codeChangeId
policyId
action
matchedRules
reason
requiredApprovals
createdAt
```

Policy decisions must be explainable and immutable/auditable.

---

# 29. Review

Represents human review/approval.

Potential fields:

```text
id
organizationId
codeChangeId
reviewerId
reviewType
status
comment
createdAt
```

Review types:

```text
ENGINEERING
SECURITY
SENIOR_ENGINEER
COMPLIANCE
OTHER
```

---

# 30. Evidence

Evidence is one of the central concepts in the system.

Conceptual fields:

```text
id
organizationId
codeChangeId
type
source
result
timestamp
metadata
```

Examples:

```text
SAST
PASS
CodeQL

SECRET_SCAN
PASS
GitHub

DEPENDENCY_SCAN
FAIL
Snyk

TESTS
PASS
GitHub Actions

HUMAN_REVIEW
PASS
John Doe

POLICY
REVIEW_REQUIRED
AI-SDLC
```

Evidence should be immutable wherever possible.

---

# 31. Change Passport

The Change Passport is a **derived security record** representing the complete trust/evidence story of a code change.

It should not initially be the canonical source of truth.

It should be constructed from:

```text
AIActivity
CodeChange
RiskAssessment
SecurityFinding
Evidence
PolicyDecision
Review
Repository
PullRequest
Commit
```

Example:

```text
AI CHANGE PASSPORT
────────────────────────────────

Repository
payments-api

PR
#1842

Change
Refund authorization

────────────────────────────────

AI INVOLVEMENT

AI contribution       84%
Primary agent         Claude Code
Model                 Claude Sonnet
Human author          developer@example.com

Attribution confidence:
94%

────────────────────────────────

AGENT CAPABILITIES

Repository read       ✓
Repository write      ✓
Run tests             ✓
Install packages      ✓

Production DB         ✗
Production secrets    ✗
Customer data         ✗

────────────────────────────────

CHANGE CONTEXT

Payment logic         CRITICAL
Authorization         CRITICAL
Database               HIGH
Tests                  LOW

────────────────────────────────

SECURITY CONTROLS

SAST                   ✓
Secret scan            ✓
Dependency scan        ✓
AI security analysis   ✓
Tests                  ✓

────────────────────────────────

POLICY

Payment changes:
Security review required.

────────────────────────────────

APPROVAL

Developer              ✓
Senior engineer        ✓
Security               ✓

────────────────────────────────

FINAL STATUS

APPROVED
```

---

# 32. Risk Engine

The risk engine must be deterministic and explainable in the MVP.

Initial risk factors may include:

```text
AI involvement
AI attribution confidence
Sensitive subsystem
Repository criticality
Agent permissions
New dependencies
Secrets touched
Infrastructure changes
Authentication changes
Authorization changes
Payment logic
Database migrations
Change size
Security findings
Test results
SAST results
Secret scanning results
Dependency results
Trusted signals
```

Example scoring model:

```text
AI contribution           +20
Payment code              +30
Authorization code        +25
New dependency            +10
Large change              +10
Critical repository       +10

Secret scan passed         -5
SAST passed                -5
Tests passed               -5

Total                      90
```

Initial thresholds:

```text
0–29      LOW
30–59     MEDIUM
60–79     HIGH
80–100    CRITICAL
```

These thresholds and weights are provisional and must be configurable in future versions.

Do not allow negative scores or scores over 100.

---

# 33. Risk Explainability

Every assessment should provide:

```text
score
level
factors
positiveFactors
negativeFactors
modelVersion
timestamp
```

Example:

```json
{
  "score": 87,
  "level": "CRITICAL",
  "factors": [
    {
      "name": "payment_subsystem",
      "weight": 30
    },
    {
      "name": "authorization_logic",
      "weight": 25
    },
    {
      "name": "ai_involvement",
      "weight": 20
    }
  ],
  "modelVersion": "risk-v1"
}
```

---

# 34. Policy Engine

Policy evaluation consumes:

```text
Organization
Repository
Repository criticality
PullRequest
CodeChange
AIActivity
RiskAssessment
SecurityFindings
Evidence
```

and produces:

```text
PolicyDecision
```

Possible outcomes:

```text
ALLOW
REVIEW
BLOCK
```

Examples:

### Payment policy

```text
IF AI involved
AND payment code touched
THEN security review required
```

### Authentication policy

```text
IF AI involved
AND authentication code touched
THEN senior engineer review required
```

### Production infrastructure

```text
IF AI involved
AND production infrastructure changed
THEN security + platform review required
```

### Secrets

```text
IF AI involved
AND secrets are touched
THEN BLOCK
```

### High-risk changes

```text
IF AI involved
AND risk >= 80
THEN security review required
```

---

# 35. Policy Evaluation Must Be Deterministic

Do not use an LLM to determine whether a policy is violated in the first version.

The engine should evaluate explicit conditions.

An LLM may eventually assist with:

- semantic code classification
- natural-language policy creation
- policy recommendations
- contextual explanations

But the final enforcement result must be deterministic.

---

# 36. GitHub Integration

The first source-control integration is GitHub.

Build a **GitHub App**, not a personal access token.

The app should eventually use:

```text
pull_request
push
installation
installation_repositories
workflow_run
```

Start with the smallest set needed.

The app must use the minimum GitHub permissions necessary.

---

# 37. GitHub Webhook Flow

When a PR is opened or updated:

```text
GitHub
   |
   v
POST /webhooks/github
   |
   v
Verify webhook signature
   |
   v
Identify GitHub installation
   |
   v
Map installation -> Organization
   |
   v
Identify repository
   |
   v
Identify PR
   |
   v
Persist/update PR metadata
   |
   v
Queue analysis job
   |
   v
Return HTTP 2xx quickly
```

Never run full analysis synchronously in the webhook request.

---

# 38. Worker Analysis Pipeline

The first analysis pipeline should be:

```text
1. Receive PR analysis job

2. Fetch PR metadata

3. Fetch commits

4. Fetch changed files

5. Determine AI signals

6. Determine AI attribution/confidence

7. Classify changed files

8. Determine sensitive areas

9. Calculate repository/change risk

10. Collect available security evidence

11. Load applicable policies

12. Evaluate policies

13. Persist risk assessment

14. Persist policy decision

15. Build/update Change Passport

16. Publish GitHub Check Run

17. Optionally comment on PR

18. Mark job complete
```

The pipeline should be idempotent.

If the same webhook is received twice, the system should not create duplicate logical analysis results.

---

# 39. AI Provenance

AI attribution is a difficult problem and must be treated as probabilistic unless directly verified.

Potential sources:

```text
developer declaration
agent telemetry
Git metadata
IDE integration
behavioral inference
CI signals
agent-specific metadata
future local agent
```

Output:

```text
AI involvement:
YES / NO / UNKNOWN

agent:
claude-code / codex / copilot / cursor / unknown

confidence:
0.00–1.00

source:
developer_declared / behavioral_inference / etc.
```

Example:

```text
Agent:
Claude Code

Confidence:
0.94

Source:
Developer declaration
```

or:

```text
Agent:
Unknown

Confidence:
0.61

Source:
Behavioral inference
```

Never make false certainty claims.

---

# 40. Change Classification

The classifier should inspect changed files and eventually semantic content.

Initial categories:

```text
AUTHENTICATION
AUTHORIZATION
PAYMENTS
CRYPTOGRAPHY
SECRETS
DATABASE
PERSONAL_DATA
INFRASTRUCTURE
NETWORKING
API
DEPENDENCIES
CI_CD
CONTAINERS
LOGGING
FRONTEND
TESTING
DOCUMENTATION
```

Examples:

```text
src/auth/session.ts
    -> AUTHENTICATION

src/payments/refund.ts
    -> PAYMENTS

terraform/production/iam.tf
    -> INFRASTRUCTURE

prisma/schema.prisma
    -> DATABASE
```

The classifier should support multiple categories per change.

---

# 41. AI Change Passport in GitHub

The PR experience should eventually show:

```text
AI-SDLC Security

AI involvement: 82%
Risk: HIGH

Sensitive areas:
- Payments
- Authorization

Security checks:
✓ Tests
✓ Secret scan
✓ Dependency scan

Policy:
⚠ Security approval required

Status:
REVIEW REQUIRED

View AI Change Passport
```

The GitHub Check Run is preferred over noisy comments when possible.

Comments can be added selectively.

---

# 42. Dashboard

Initial navigation:

```text
Overview
Changes
AI Agents
Repositories
Policies
Evidence
Settings
```

## Overview

Metrics:

```text
AI-assisted PRs
High-risk changes
Critical changes
Policy violations
Blocked changes
Unverified changes
```

## Changes

Table:

```text
PR
Repository
Author
AI agent
AI confidence
Risk
Sensitive areas
Policy
Status
Created
```

Filters:

```text
repository
agent
risk
status
sensitive area
policy
date
author
```

## AI Agents

Display:

```text
Agent
Usage
PRs
Repositories
Risk
Policy violations
```

## Repositories

Display:

```text
Repository
Criticality
AI activity
High-risk changes
Policy violations
Monitoring status
```

## Policies

Create/edit/enable/disable policies.

## Evidence

Search security evidence and Change Passports.

---

# 43. Initial Dashboard Metrics

Example:

```text
AI-assisted PRs       1,482
High-risk             73
Blocked               19
Missing provenance    124
Policy violations     31
Unreviewed            8
```

Potential AI risk distribution:

```text
Payments           93
Authentication     87
Infrastructure     79
Database           71
API                54
Frontend            22
```

Agent distribution:

```text
Claude Code         41%
Copilot             27%
Codex               19%
Cursor               9%
Unknown              4%
```

These are UI examples, not fixed values.

---

# 44. Privacy Architecture

Privacy is a strategic differentiator.

The default architecture should minimize source-code and prompt retention.

Preferred flow:

```text
Customer environment
       |
       v
GitHub / local analysis
       |
       v
Minimal necessary analysis
       |
       v
Telemetry minimization
       |
       v
AI-SDLC Control Plane
```

Do not default to:

```text
Customer source code
      |
      v
Permanent cloud storage
```

The product should eventually support:

### Cloud analysis

Convenient default.

### Private analysis

Processing inside customer infrastructure.

### Self-hosted deployment

For highly sensitive organizations.

---

# 45. Privacy Rules

Never intentionally collect:

- AI conversation histories unless explicitly required
- raw prompts by default
- secrets
- credentials
- customer PII
- complete repositories when unnecessary

Prefer:

```text
file path
file hash
diff metadata
classification
security finding
risk factor
policy result
evidence metadata
```

If source snippets are required for AI analysis, make retention:

- ephemeral
- configurable
- encrypted
- explicitly documented

---

# 46. Security Requirements

The product itself is security-critical.

## Authentication

Use secure session management.

## Authorization

All API resources must be tenant scoped and role checked.

## GitHub

Verify webhook signatures.

Use installation-specific tokens.

Never use a broad personal access token for the platform architecture.

## Secrets

Never log:

- GitHub private keys
- access tokens
- database passwords
- API keys
- customer secrets

## Database

Use:

- parameterized ORM queries
- least-privileged DB credentials
- encrypted connections where applicable
- backups
- migrations

## Audit

Record security-sensitive administrative actions.

## Encryption

Use TLS in transit.

Encrypt sensitive data at rest.

---

# 47. Multi-Tenant Security

Every request should establish:

```text
authenticated user
        |
        v
organization membership
        |
        v
requested resource
        |
        v
resource.organizationId
```

The server must reject cross-tenant access.

Do not rely on frontend organization filtering.

Do not trust a client-supplied `organizationId` without verifying membership.

---

# 48. Audit Events

Eventually create:

```text
AuditEvent
```

Examples:

```text
USER_LOGIN
GITHUB_INSTALLATION_CREATED
REPOSITORY_ENABLED
POLICY_CREATED
POLICY_UPDATED
POLICY_DELETED
POLICY_EVALUATED
CHANGE_BLOCKED
CHANGE_APPROVED
REVIEW_APPROVED
API_KEY_CREATED
API_KEY_REVOKED
```

Audit events should be append-only.

---

# 49. Security Provider Abstraction

The system must not be coupled to a specific scanner.

Define an abstraction similar to:

```typescript
interface SecurityProvider {
  name: string;

  analyze(change: CodeChange): Promise<SecurityResult>;

  getFindings(changeId: string): Promise<SecurityFinding[]>;
}
```

Potential integrations:

```text
CodeQL
Semgrep
Snyk
Sonar
GitHub Advanced Security
future DAST
future container scanners
future IaC scanners
```

Normalize all results into `SecurityFinding`.

---

# 50. Evidence Aggregation

The evidence layer should combine:

```text
SAST
SCA
Secrets
Tests
Dependency checks
CI status
Human reviews
Security approvals
Policy evaluations
AI attribution
```

into a single change-level record.

Example:

```text
Change #82914

AI provenance:
PASS

SAST:
PASS

Secrets:
PASS

Dependencies:
PASS

Tests:
PASS

Security review:
PASS

Policy:
PASS

Final:
APPROVED
```

---

# 51. CI/CD Integration

Initially, GitHub Actions evidence can be collected through GitHub APIs/webhooks.

Eventually support:

```text
GitHub Actions
GitLab CI
CircleCI
Jenkins
Buildkite
Azure Pipelines
```

The platform should normalize:

```text
pipeline
job
status
timestamp
commit
branch
workflow
artifact
```

---

# 52. Deployment Evidence

This is a future phase, but the architecture should allow:

```text
Code Change
    |
    v
PR
    |
    v
Security Verification
    |
    v
Policy Decision
    |
    v
Approval
    |
    v
Deployment
```

Eventually we should be able to answer:

> "Did this AI-assisted change reach production?"

and:

> "Did it satisfy all required policies before deployment?"

---

# 53. Long-Term Evidence Graph

Eventually the product should maintain a graph-like relationship:

```text
Developer
   |
   v
AI Agent
   |
   +--> Model
   |
   +--> Tools
   |
   +--> Permissions
   |
   v
AI Activity
   |
   v
Repository
   |
   v
Files
   |
   v
Commit
   |
   v
Pull Request
   |
   v
Security Controls
   |
   v
Policy
   |
   v
Approval
   |
   v
Deployment
```

This becomes a core long-term differentiator.

The system should eventually answer:

- Which production applications contain AI-generated changes?
- Which agents have modified authentication code?
- Which AI-generated payment changes entered production without security approval?
- Which agents have access to critical repositories?
- Which production incidents involve AI-generated changes?
- Which AI changes lack verifiable provenance?

---

# 54. AI Risk Map

Future dashboard capability:

```text
AI RISK MAP

Authentication       82
Payments             91
Authorization        88
Database             63
Infrastructure       79
API                  55
UI                   21
Tests                13
Documentation         4
```

The score should be derived from actual observed changes and repository context, not arbitrary static labels.

---

# 55. AI Change Coverage

Future organization metrics:

```text
AI-assisted changes
AI-attributed changes
Unknown-provenance changes
High-risk AI changes
Policy-compliant changes
Changes requiring review
Changes blocked
Changes reaching production
```

Possible KPI:

```text
AI Change Governance Coverage =
AI changes with verified evidence
---------------------------------
Total AI-assisted changes
```

This can become a key executive metric.

---

# 56. AI Agent Risk

Eventually track:

```text
Agent
Repositories accessed
Sensitive areas touched
Average risk
Policy violations
Blocked operations
Security findings
Human overrides
```

Example:

```text
Claude Code

Repositories:
27

AI-assisted PRs:
1,208

High-risk:
63

Policy violations:
11

Blocked:
4
```

This allows security teams to compare agent usage by risk.

---

# 57. Agent Permissions

The long-term platform should understand:

```text
Agent
   |
   +-- repository read
   +-- repository write
   +-- package installation
   +-- shell execution
   +-- network
   +-- production DB
   +-- secrets
   +-- MCP
   +-- deployment
```

This enables future policies like:

```text
AI agents cannot access production credentials.
```

or:

```text
AI agents may modify frontend repositories
but cannot directly modify infrastructure.
```

---

# 58. Future Local Agent

A future customer-side component may provide:

```text
AI-SDLC Local Agent

- inspect local changes
- collect provenance
- classify files
- run local analysis
- fingerprint AI activity
- minimize telemetry
- send only necessary evidence
```

This allows stronger privacy guarantees.

Do not build this in the first MVP unless required by an actual customer.

---

# 59. Future AI Agent Runtime Controls

The long-term platform may expand from development governance into agent controls:

```text
Agent
  |
  v
Policy
  |
  +--> allowed tools
  +--> allowed repositories
  +--> allowed paths
  +--> allowed commands
  +--> allowed network
  +--> allowed environments
  +--> approval requirements
```

This is intentionally a later stage because it overlaps with an increasingly competitive agent-security market.

---

# 60. Future Compliance

Potential future evidence outputs:

- audit reports
- AI development governance reports
- policy compliance reports
- change provenance reports
- security review evidence
- incident investigation timelines

Potential standards/framework mappings can be added later based on actual customer demand.

Do not build compliance-framework checklists before the core evidence model works.

---

# 61. MVP Scope

The first production-capable MVP should include:

### GitHub

- GitHub App
- installation
- repository discovery
- webhook ingestion
- PR synchronization

### AI provenance

- initial AI involvement signals
- confidence
- provenance source
- unknown state

### Change analysis

- changed file collection
- sensitive-area classification
- basic AI contribution signal

### Risk

- deterministic risk engine
- explainable scoring
- risk level

### Policy

- basic policy engine
- ALLOW / REVIEW / BLOCK
- configurable policies

### Evidence

- GitHub CI evidence
- security result model
- human review evidence
- policy evidence

### GitHub UX

- GitHub Check Run
- review-required status
- risk summary
- passport link

### Dashboard

- overview
- changes
- repositories
- agents
- policies
- evidence/passports

### Security

- authentication
- RBAC
- tenant isolation
- audit logging
- webhook signature verification
- secret management

---

# 62. Explicitly Out of MVP

Do NOT build initially:

- GitLab
- Bitbucket
- Azure DevOps
- full IDE plugins
- full MCP security gateway
- production runtime agent protection
- complete SAST engine
- complete SCA engine
- custom vulnerability database
- custom LLM
- employee surveillance
- full prompt storage
- full source-code warehousing
- Kubernetes deployment
- SAML
- enterprise private deployment
- advanced compliance framework mappings
- autonomous remediation
- complicated policy DSL
- multi-cloud deployment

Build the smallest system that proves the product thesis.

---

# 63. Development Roadmap

## Phase 0 — Foundation

Deliver:

```text
Monorepo
pnpm
Next.js
Hono
Worker
PostgreSQL
Prisma
Redis
BullMQ
Docker Compose
Environment configuration
Basic CI
```

Success condition:

```text
docker compose up
```

runs:

```text
web
api
worker
postgres
redis
```

---

## Phase 1 — GitHub Integration

Deliver:

```text
GitHub App
OAuth
Installation
Repository sync
Webhook signature validation
PR sync
Commit sync
```

Success condition:

```text
Install App
   |
Open PR
   |
Webhook arrives
   |
PR stored
```

---

## Phase 2 — Analysis Pipeline

Deliver:

```text
PR
 |
+--> changed files
 |
+--> AI signal
 |
+--> sensitive classification
 |
+--> risk
```

Success condition:

A PR produces:

```text
AI involvement
Sensitive areas
Risk score
Risk explanation
```

---

## Phase 3 — Policy Engine

Deliver:

```text
Risk
 +
Change context
 +
Organization policy
 =
ALLOW / REVIEW / BLOCK
```

Success condition:

Payment + AI:

```text
REVIEW
```

Secrets + AI:

```text
BLOCK
```

Low-risk frontend + AI:

```text
ALLOW
```

---

## Phase 4 — Evidence

Deliver:

```text
CI status
Security findings
Human review
Policy decision
AI provenance
```

Success condition:

The system can reconstruct the complete security story of a PR.

---

## Phase 5 — Change Passport

Deliver:

```text
AI Change Passport
```

Success condition:

A security user can understand:

```text
what happened
who/what caused it
what changed
what risks existed
what controls ran
what policies applied
who approved it
what the final decision was
```

---

## Phase 6 — Dashboard

Deliver:

```text
Overview
Changes
Agents
Repositories
Policies
Evidence
```

Success condition:

Security personnel can operate the MVP without querying the database.

---

## Phase 7 — GitHub Enforcement

Deliver:

```text
Check Runs
PR status
Review required
Block merge where technically appropriate
```

Do not blindly block production workflows without configurable enforcement.

---

## Phase 8 — Better AI Attribution

Investigate:

```text
Claude Code
Codex
Copilot
Cursor
Gemini
Windsurf
OpenHands
```

Combine:

```text
developer declaration
agent telemetry
Git metadata
behavioral signals
IDE signals
CI signals
```

Always expose confidence.

---

## Phase 9 — Security Integrations

Add:

```text
CodeQL
Semgrep
Snyk
Sonar
GitHub Advanced Security
```

Normalize findings through the provider abstraction.

---

## Phase 10 — GitLab and Beyond

Add:

```text
GitLab
Bitbucket
Azure DevOps
```

The internal domain model should not be GitHub-specific.

---

# 64. Recommended Development Workflow

Build in vertical slices.

Do NOT build the whole database first, then the whole API, then the whole frontend.

Preferred sequence:

```text
GitHub event
   |
   v
Persist PR
   |
   v
Analyze PR
   |
   v
Calculate risk
   |
   v
Apply policy
   |
   v
Create evidence
   |
   v
Show result in GitHub
   |
   v
Show result in dashboard
```

Every slice should work end-to-end.

---

# 65. Testing Strategy

Testing is critical because this is security infrastructure.

## Unit tests

Test:

- risk calculations
- policy rules
- classification
- provenance confidence
- severity normalization
- tenant authorization

## Integration tests

Test:

- PostgreSQL
- Redis
- worker
- GitHub API client
- webhook verification
- policy evaluation pipeline

## End-to-end tests

Test:

```text
GitHub PR
   |
Webhook
   |
Queue
   |
Worker
   |
Analysis
   |
Risk
   |
Policy
   |
Evidence
   |
GitHub Check
   |
Dashboard
```

## Security tests

Explicitly test:

- cross-tenant access
- invalid GitHub signatures
- forged webhook payloads
- unauthorized policy changes
- privilege escalation
- token leakage
- SQL injection
- SSRF
- malicious repository content
- malicious file names/paths
- prompt injection against future LLM analysis
- unsafe deserialization
- untrusted GitHub data

---

# 66. Idempotency

GitHub webhooks may be delivered more than once.

All event processing must be idempotent.

Use:

```text
GitHub event ID
```

or an equivalent unique event identifier.

Do not allow duplicate:

- PR records
- analysis jobs
- evidence
- policy decisions
- Change Passports

---

# 67. Asynchronous Processing

Webhook handlers should:

1. validate
2. identify tenant
3. persist minimal event
4. enqueue job
5. return success

The worker handles expensive operations.

Use BullMQ job types such as:

```text
github.pr.analyze
github.repository.sync
github.commit.sync
security.findings.sync
passport.rebuild
```

---

# 68. Error Handling

Failures should be explicit.

Example job states:

```text
QUEUED
RUNNING
SUCCEEDED
FAILED
RETRYING
CANCELLED
```

Analysis failures must not silently become:

```text
SAFE
```

If analysis cannot complete, the platform should be able to represent:

```text
UNKNOWN
ANALYSIS_FAILED
REVIEW_REQUIRED
```

depending on the applicable policy.

Never equate missing evidence with passing evidence.

---

# 69. Important Security Semantics

These distinctions must remain explicit:

```text
PASS
FAIL
UNKNOWN
NOT_RUN
NOT_APPLICABLE
```

Do not collapse them into a boolean.

For example:

```text
Secret scan:
NOT_RUN
```

must not become:

```text
Secret scan:
PASS
```

Similarly:

```text
AI attribution:
UNKNOWN
```

must not become:

```text
AI not involved
```

---

# 70. AI Analysis Guidelines

When LLMs are introduced:

- treat repository content as untrusted input
- treat PR descriptions as untrusted input
- treat comments as untrusted input
- treat code comments as untrusted input
- prevent prompt injection from changing system instructions
- never allow model output to directly execute privileged operations
- validate structured output against schemas
- use deterministic fallbacks
- log model/version metadata for reproducibility
- keep sensitive source retention minimal

LLMs should not be trusted to enforce security policy directly.

---

# 71. Repository Criticality

Repositories should eventually have a configurable criticality:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

This affects risk.

Example:

```text
AI modifies documentation
criticality LOW
=> LOW risk

AI modifies authorization
criticality CRITICAL
=> elevated risk
```

The same code change can have different organizational impact depending on the repository.

---

# 72. Sensitive Path Configuration

Organizations should eventually be able to configure sensitive paths.

Example:

```text
src/auth/**
src/payments/**
infra/prod/**
terraform/iam/**
src/crypto/**
```

These can override automatic classification.

This creates a powerful combination:

```text
Automatic classification
+
Organization-specific knowledge
```

---

# 73. Policy Precedence

Policies may overlap.

Example:

```text
AI + payments
AI + critical repository
AI + high risk
```

The policy engine needs deterministic precedence.

Recommended initial behavior:

```text
BLOCK
  >
REVIEW
  >
ALLOW
```

If multiple policies match:

- all required approvals are combined
- the strongest action wins
- conflicts are recorded
- the decision explains which rules matched

---

# 74. Policy Versioning

Policies will change.

Every policy decision must reference the policy version that produced it.

Example:

```text
Policy:
AI Payment Protection

Version:
3

Decision:
REVIEW
```

Historical evidence must remain understandable even after policy version 4 is deployed.

---

# 75. Change Passport Integrity

The Change Passport should eventually be tamper-evident.

Potential future mechanisms:

- immutable evidence records
- event hashes
- hash chains
- signed evidence
- timestamping
- cryptographic attestations

Do not overengineer cryptography in v0.1.

But keep the architecture compatible with immutable/tamper-evident evidence.

---

# 76. API Design Principles

Use resource-oriented endpoints.

Potential API shape:

```text
/api/organizations
/api/organizations/:id
/api/organizations/:id/members

/api/github/installations
/api/github/webhooks

/api/repositories
/api/repositories/:id
/api/repositories/:id/changes

/api/pull-requests
/api/pull-requests/:id

/api/agents
/api/agents/:id

/api/policies
/api/policies/:id

/api/evidence
/api/evidence/:id

/api/passports
/api/passports/:id

/api/audit-events
```

Webhook endpoint:

```text
POST /api/webhooks/github
```

Exact route organization can be adjusted to the implementation framework.

---

# 77. API Response Rules

Use consistent response shapes.

Success:

```json
{
  "data": {},
  "error": null
}
```

Failure:

```json
{
  "data": null,
  "error": {
    "code": "POLICY_NOT_FOUND",
    "message": "Policy not found"
  }
}
```

Do not leak internal errors or secrets.

---

# 78. Frontend Architecture

Use server components where appropriate.

Use client components only when interaction/state requires them.

Recommended areas:

```text
app/
  dashboard/
  changes/
  repositories/
  agents/
  policies/
  evidence/
  settings/
```

Components:

```text
RiskBadge
RiskBreakdown
AIAttributionCard
PolicyDecisionBadge
EvidenceList
ChangePassport
SecurityFindingList
RepositoryCard
AgentCard
PolicyEditor
```

Keep data fetching close to route/page boundaries.

Avoid duplicating business logic in React components.

---

# 79. UX Principles

The security product must not feel like a punishment system.

For developers:

Bad:

> "Security blocked your PR."

Better:

> "This AI-assisted change modifies payment authorization. Your organization's policy requires security approval before merge."

Show:

- why
- what was detected
- which policy matched
- what must happen next
- who needs to approve

Security decisions should be actionable.

---

# 80. Change Passport UX

The passport should have sections:

```text
Overview
AI Attribution
Change Scope
Risk
Security Controls
Policy
Reviews
Evidence
Timeline
```

Example timeline:

```text
10:12 AI-assisted change detected
10:14 PR opened
10:15 Risk assessment completed
10:15 Payment policy matched
10:16 SAST passed
10:16 Secret scan passed
10:20 Security review requested
10:31 Security approval received
10:32 Policy satisfied
10:33 PR approved
```

This timeline becomes extremely valuable during incident investigations.

---

# 81. Incident Investigation

Future functionality should allow a security team to investigate:

```text
Incident
   |
   v
Production deployment
   |
   v
Commit
   |
   v
Pull Request
   |
   v
AI Activity
   |
   v
Agent
   |
   v
Policy
   |
   v
Evidence
```

Questions the platform should answer:

- Was AI involved?
- Which agent?
- What confidence?
- What files changed?
- Which sensitive areas?
- What security checks ran?
- Which policy applied?
- Who reviewed it?
- Was the policy bypassed?
- Did an override occur?
- When did it reach production?

---

# 82. Override Handling

Security teams will need exceptions.

Future feature:

```text
Policy:
BLOCK

Override:
Allowed by authorized security administrator

Reason:
Emergency production incident

Approved by:
Security Admin

Expiration:
2026-08-05 18:00 UTC
```

Overrides must:

- require authorization
- require a reason
- be auditable
- optionally expire
- never silently change the underlying policy decision

---

# 83. Future Integrations

Potential integration roadmap:

### Source control

- GitHub
- GitLab
- Bitbucket
- Azure DevOps

### AI agents

- Claude Code
- Codex
- Copilot
- Cursor
- Gemini
- Windsurf
- OpenHands
- custom agents

### Security

- CodeQL
- Semgrep
- Snyk
- Sonar
- GitHub Advanced Security

### CI/CD

- GitHub Actions
- GitLab CI
- Jenkins
- CircleCI
- Buildkite
- Azure Pipelines

### Notifications

- Slack
- Microsoft Teams
- email
- webhook

Do not implement integrations until the core abstraction is stable.

---

# 84. Product Differentiators

The platform should eventually differentiate through:

## 1. Vendor neutrality

AI provider agnostic.

SCM agnostic.

Security-tool agnostic.

## 2. Provenance

Not just "vulnerable/not vulnerable."

Who/what produced the change?

## 3. Context-aware risk

AI + sensitive code + repository criticality + security evidence.

## 4. Policy

Organizations define how AI is allowed to participate.

## 5. Evidence

A complete chain of trust.

## 6. Privacy

Do not turn AI governance into employee surveillance.

## 7. Change Passport

A portable, understandable security record for each AI-assisted change.

---

# 85. What Not To Build

Explicit anti-goals:

### Do not build another generic scanner.

### Do not build a generic AI code reviewer.

### Do not claim perfect AI attribution.

### Do not store every AI conversation.

### Do not permanently store complete source code by default.

### Do not replace existing AppSec tools.

### Do not make the product GitHub-specific internally.

### Do not let LLM output directly make privileged security decisions.

### Do not make risk scores opaque.

### Do not equate "unknown" with "safe."

### Do not build every integration before proving the core workflow.

---

# 86. Product Economics

The product is intended as enterprise security infrastructure.

Initial pricing hypothesis only:

```text
Starter:
$500–$1,000/month

Growth:
$2,000–$5,000/month

Enterprise:
$20,000–$100,000+/year
```

Possible enterprise pricing dimensions:

- monitored repositories
- developer count
- AI activity volume
- evidence retention
- private deployment
- advanced integrations
- support/SLA
- compliance features

Pricing must eventually be validated against customer willingness to pay.

---

# 87. Business Goal

Potential $1M ARR paths:

```text
20 customers × $50k ARR = $1M ARR
```

or:

```text
50 customers × $20k ARR = $1M ARR
```

or:

```text
100 customers × $10k ARR = $1M ARR
```

The goal is not to acquire millions of individual developers.

The goal is to become security infrastructure that organizations consider important enough to budget for.

---

# 88. Long-Term Product Architecture

The eventual platform could become:

```text
                  AI-SDLC CONTROL PLANE

                           |
         +-----------------+-----------------+
         |                 |                 |
         v                 v                 v
    PROVENANCE          POLICY           SECURITY
         |                 |                 |
         v                 v                 v
    AI identity       Rules engine      SAST/SCA
    Agent identity    Permissions       Secrets
    Human identity    Approvals         Supply chain
         |                 |                 |
         +-----------------+-----------------+
                           |
                           v
                       RISK ENGINE
                           |
                           v
                    EVIDENCE GRAPH
                           |
            +--------------+--------------+
            |              |              |
            v              v              v
         DevOps         Security        Audit
```

And:

```text
Claude
Codex
Cursor
Copilot
Gemini
Internal Agents
       |
       v
AI-SDLC CONTROL PLANE
       |
       v
GitHub / GitLab / Bitbucket
       |
       v
CI/CD
       |
       v
Production
```

---

# 89. Long-Term Strategic Expansion

Potential product expansion:

### Stage 1

AI Change Governance

### Stage 2

AI Agent Governance

### Stage 3

Agent permissions and runtime controls

### Stage 4

AI development compliance/evidence

### Stage 5

Full Agentic SDLC Security Platform

The product should not jump to Stage 5 before Stage 1 has proven customer demand.

---

# 90. Development Milestone Definition

The first meaningful end-to-end milestone is:

```text
Install GitHub App
        |
        v
Open Pull Request
        |
        v
Webhook received
        |
        v
PR stored
        |
        v
Analysis queued
        |
        v
Worker analyzes change
        |
        v
AI involvement detected/unknown
        |
        v
Sensitive areas classified
        |
        v
Risk calculated
        |
        v
Policy evaluated
        |
        v
Evidence collected
        |
        v
Change Passport generated
        |
        v
GitHub Check Run published
        |
        v
Dashboard displays result
```

That is the MVP's central golden path.

---

# 91. Initial Implementation Order

Build in exactly this broad order unless implementation discoveries require adjustment:

```text
1. Repository foundation
2. Docker development environment
3. PostgreSQL + Prisma
4. Redis + BullMQ
5. API skeleton
6. Worker skeleton
7. Next.js dashboard skeleton
8. Authentication
9. Organization/tenant model
10. GitHub App
11. GitHub installation flow
12. Webhook verification
13. PR ingestion
14. Commit/changed-file ingestion
15. Analysis job
16. AI provenance abstraction
17. Sensitive-area classifier
18. Risk engine
19. Policy engine
20. Evidence model
21. GitHub Check Run
22. Change Passport
23. Dashboard
24. Audit logging
25. Security hardening
26. Integration testing
27. End-to-end testing
```

Do not skip directly to the dashboard.

---

# 92. Definition of Done for MVP

The MVP is not done when the UI looks good.

It is done when the following works reliably:

### Organization

- user can authenticate
- organization exists
- tenant isolation works

### GitHub

- organization installs GitHub App
- repository can be enabled
- webhook signature is validated
- PR is received

### Analysis

- changed files are retrieved
- AI involvement can be represented
- attribution confidence exists
- sensitive areas are classified
- risk is calculated

### Policy

- applicable policies are evaluated
- ALLOW / REVIEW / BLOCK works
- decisions are explainable

### Evidence

- CI/security/human-review evidence can be represented
- unknown/not-run states are preserved

### GitHub

- Check Run is published
- status is understandable
- policy failures are actionable

### Dashboard

- change is visible
- risk is visible
- AI provenance is visible
- policy decision is visible
- evidence is visible
- passport is viewable

### Security

- tenant isolation
- RBAC
- webhook verification
- secret management
- audit logs
- no sensitive secrets in logs

---

# 93. Engineering Rules for Cursor

When using Cursor to develop this repository:

1. **Do not make large speculative changes.**
2. Implement one vertical slice at a time.
3. Before modifying a subsystem, inspect the existing implementation.
4. Preserve existing architecture unless there is a concrete reason to change it.
5. Do not invent APIs from memory when the project already has an abstraction.
6. Keep business logic in domain/service packages rather than route handlers.
7. Use strict TypeScript.
8. Validate external inputs with schemas.
9. Treat GitHub webhook payloads as untrusted input.
10. Never trust client-provided organization IDs.
11. Never expose secrets in logs.
12. Add tests for security-sensitive logic.
13. Use database transactions where multiple related records must be consistent.
14. Make background jobs idempotent.
15. Make policy decisions reproducible.
16. Version the risk model.
17. Preserve UNKNOWN / NOT_RUN / NOT_APPLICABLE states.
18. Never equate lack of evidence with PASS.
19. Do not add an LLM where deterministic logic is sufficient.
20. Do not introduce a dependency without understanding why it is necessary.

---

# 94. Cursor Prompting Strategy

For large tasks, do not tell Cursor:

> "Build the entire platform."

Instead give it bounded tasks.

Good:

> "Inspect the repository and implement the Prisma models required for Organization, User, OrganizationMember and GitHubInstallation. Do not modify unrelated files. Add migrations and tests."

Then:

> "Implement the GitHub webhook endpoint. Verify GitHub signatures, resolve the installation to an organization, persist the event, and enqueue a BullMQ job. Do not perform analysis synchronously."

Then:

> "Implement the PR analysis worker using the existing domain interfaces. Fetch changed files, classify sensitive areas, calculate risk using risk-v1, persist the assessment, and publish a GitHub Check Run."

Each task should have:

- objective
- constraints
- files/subsystems
- acceptance criteria
- tests

---

# 95. Initial Risk Engine Interface

A useful conceptual interface:

```typescript
interface RiskContext {
  aiInvolvement: boolean;
  aiConfidence: number;
  repositoryCriticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  sensitiveAreas: string[];
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  newDependencies: number;
  securityFindings: SecurityFinding[];
  securityEvidence: Evidence[];
}

interface RiskAssessment {
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  factors: RiskFactor[];
  modelVersion: string;
}
```

The actual implementation should be designed around the repository's existing conventions.

---

# 96. Initial Policy Engine Interface

Conceptually:

```typescript
interface PolicyContext {
  organizationId: string;
  repository: RepositoryContext;
  codeChange: CodeChangeContext;
  aiActivity?: AIActivityContext;
  riskAssessment: RiskAssessment;
  securityFindings: SecurityFinding[];
  evidence: Evidence[];
}

interface PolicyDecision {
  action: "ALLOW" | "REVIEW" | "BLOCK";
  matchedPolicies: MatchedPolicy[];
  requiredApprovals: ApprovalRequirement[];
  reasons: string[];
}
```

Again, adapt to actual project conventions rather than blindly copying this interface.

---

# 97. Security Provider Interface

Conceptually:

```typescript
interface SecurityProvider {
  name: string;

  analyze(change: CodeChange): Promise<SecurityResult>;

  getFindings(changeId: string): Promise<SecurityFinding[]>;
}
```

All providers should normalize results into the internal security finding model.

---

# 98. AI Provenance Interface

Conceptually:

```typescript
interface ProvenanceResult {
  involved: boolean | null;
  agentName?: string;
  modelName?: string;
  confidence: number;
  source:
    | "DEVELOPER_DECLARED"
    | "AGENT_TELEMETRY"
    | "GIT_METADATA"
    | "IDE_SIGNAL"
    | "BEHAVIORAL_INFERENCE"
    | "CI_SIGNAL"
    | "UNKNOWN";
  evidence: ProvenanceEvidence[];
}
```

`null` or an explicit unknown state is preferable to false certainty.

---

# 99. Important Terminology

Use these terms consistently.

### AI-assisted change

A code change where AI may have contributed.

### AI attribution

The evidence/assessment that AI contributed to a change.

### AI provenance

The source and chain of evidence establishing AI involvement.

### AI agent

An AI-powered system capable of performing software development actions.

### Sensitive area

A security/business-critical part of the software.

### Risk assessment

The explainable calculation of change risk.

### Policy

An organization's rule governing AI-assisted development.

### Policy decision

The result of applying policy to a change.

### Evidence

A security/governance signal supporting a decision.

### Change Passport

The consolidated security/evidence record for a change.

### Control Plane

The system coordinating visibility, policy, risk, and evidence across multiple development/security systems.

---

# 100. Final Product Definition

The product should ultimately be understood as:

> **AI-SDLC Control Plane is a vendor-neutral, privacy-preserving security and governance layer for organizations adopting AI coding agents. It tracks AI-assisted changes, establishes provenance and confidence, identifies sensitive code paths, calculates explainable risk, evaluates organizational policies, aggregates security evidence, coordinates human approvals, and produces an auditable AI Change Passport for every important software change.**

The central product loop is:

```text
                AI-ASSISTED DEVELOPMENT

                        |
                        v
                   AI ACTIVITY
                        |
                        v
                  PROVENANCE
                        |
                        v
                 CODE CHANGE
                        |
                        v
              SENSITIVE CLASSIFICATION
                        |
                        v
                   RISK ENGINE
                        |
                        v
                 POLICY ENGINE
                        |
              +---------+---------+
              |         |         |
              v         v         v
            ALLOW     REVIEW     BLOCK
              |         |         |
              +---------+---------+
                        |
                        v
                 SECURITY EVIDENCE
                        |
                        v
                  HUMAN REVIEW
                        |
                        v
                 CHANGE PASSPORT
                        |
                        v
                    PRODUCTION
```

The long-term vision is:

> **Make AI-assisted software development observable, controllable, verifiable, and accountable without sacrificing developer privacy or forcing organizations to replace their existing development and security tooling.**

---

# 101. Immediate Next Step

Do not implement all of this at once.

Start with:

```text
Phase 0
  |
  +-- monorepo
  +-- pnpm
  +-- Next.js
  +-- Hono
  +-- PostgreSQL
  +-- Prisma
  +-- Redis
  +-- BullMQ
  +-- Docker Compose
  +-- environment configuration
  +-- basic CI
```

Then proceed to:

```text
Phase 1
  |
  +-- GitHub App
  +-- installation
  +-- webhook
  +-- repository
  +-- PR ingestion
```

The first meaningful success criterion is:

```text
Install GitHub App
        ↓
Open PR
        ↓
Webhook received
        ↓
PR persisted
        ↓
Analysis job queued
        ↓
Worker processes PR
        ↓
Risk calculated
        ↓
Policy evaluated
        ↓
Evidence recorded
        ↓
Change Passport generated
        ↓
GitHub Check Run
        ↓
Dashboard
```

Everything else should grow from this golden path.
