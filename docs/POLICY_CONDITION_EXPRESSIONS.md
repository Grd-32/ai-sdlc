# Policy condition expressions

Organization policy rules can use either the existing simple condition fields or a nested JSON
expression. If an expression is present, it takes precedence over the simple fields for that rule.
Rules without an expression continue to use the existing fields.

## Expression format

Boolean nodes accept `AND`, `OR`, and `NOT`. Leaf conditions support AI provenance, sensitive areas,
risk score, and repository criticality:

```json
{
  "op": "AND",
  "conditions": [
    { "field": "AI_INVOLVEMENT", "equals": "YES" },
    {
      "op": "OR",
      "conditions": [
        { "field": "SENSITIVE_AREAS", "includes": ["PAYMENTS", "SECRETS"] },
        { "field": "RISK_SCORE", "atLeast": 80 }
      ]
    }
  ]
}
```

Supported leaves are:

- `AI_INVOLVEMENT`: `equals` is `YES`, `NO`, or `UNKNOWN`. A rule explicitly targeting `UNKNOWN`
  matches only unknown provenance.
- `SENSITIVE_AREAS`: `includes` is a non-empty list of supported sensitive-area names; any listed
  area matches.
- `RISK_SCORE`: `atLeast` is a number from 0 through 100.
- `REPOSITORY_CRITICALITY`: `in` is a non-empty list of `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`.

Expressions must be valid JSON and use the exact node shapes above. Validation limits each expression
to 32 nodes, eight levels of nesting, and ten children per `AND` or `OR`.

## Unknown evidence

Evaluation uses three-valued logic: `MATCH`, `NO_MATCH`, and `INDETERMINATE`. Missing AI provenance
never satisfies a legacy rule requiring confirmed AI or confirmed non-AI. An indeterminate rule
causes a `REVIEW` fallback unless another matched rule already yields a stronger action. Explicit
`AI_INVOLVEMENT = UNKNOWN` conditions can be used when an organization wants to target missing
provenance directly.

The policy editor validates expressions through the API, and the worker validates persisted
expressions again before evaluation. Malformed stored expressions fail analysis rather than silently
falling back to a less restrictive condition.

The policy dashboard can replay up to 100 recently analyzed pull requests from persisted history
against the current enabled rules. The API caps each replay at 200 records. The simulation excludes
changes whose latest analyzed SHA is stale or that have no persisted risk assessment, and reports
those counts. It can compare simulated actions with the latest persisted policy decision. Selecting
ENFORCING is a what-if mode only: simulation never updates decisions, checks, or pull requests.
Policies disabled at the policy level or organization-policy level are not included. The product does
not estimate false positives without labeled historical outcomes.

Policy creation and subsequent policy/rule changes also produce versioned JSON snapshots in the
organization database. Existing policies receive a baseline snapshot during migration. Administrators
can inspect the latest ten revisions in the policy dashboard. Database triggers reject revision
updates, direct deletes, and truncation. Foreign-key cleanup when a policy is deleted and cascading
organization deletion remain allowed; this protects snapshots from ordinary application-level
mutation, not from a database owner disabling triggers.

Enforcement approvals are revision-specific. The organization owner configures a quorum from one to
five distinct active owners or administrators (default two); the author of the current revision
cannot approve it. Approver eligibility is rechecked when policy status is read and when analysis
runs, so deactivated members, SCIM-deactivated members, and members whose role is reduced no longer
count. An `ENFORCING` policy without the current quorum is evaluated in `DRY_RUN` mode. Editing the
policy or any rule creates a new revision and resets the effective approval count. Quorum changes
are audited and immediately recalculate which current revisions are approved.
