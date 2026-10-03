/**
 * Security evidence and provider abstraction package.
 * Phase 9–10+: normalized findings, provider integrations.
 */

export type EvidenceResult = "PASS" | "FAIL" | "UNKNOWN" | "NOT_RUN" | "NOT_APPLICABLE";

export type EvidenceType =
  | "SAST"
  | "SCA"
  | "SECRET_SCAN"
  | "TESTS"
  | "CI"
  | "HUMAN_REVIEW"
  | "SECURITY_REVIEW"
  | "POLICY"
  | "AI_PROVENANCE";

export type FindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type FindingCategory =
  | "SAST"
  | "SCA"
  | "SECRET"
  | "DAST"
  | "CONTAINER"
  | "IAC"
  | "MALICIOUS_DEPENDENCY"
  | "AI_SECURITY"
  | "OTHER";

export interface SecurityFinding {
  provider: string;
  providerFindingId: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description?: string;
  file?: string;
  line?: number;
  ruleId?: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityEvidence {
  type: EvidenceType;
  source: string;
  result: EvidenceResult;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface SecurityResult {
  findings: SecurityFinding[];
  evidence: SecurityEvidence[];
}

export interface SecurityProvider {
  name: string;
  analyze(changeId: string): Promise<SecurityResult>;
  getFindings(changeId: string): Promise<SecurityFinding[]>;
}

export interface EvidenceSummary {
  result: EvidenceResult;
  count: number;
}

const normalizeString = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function normalizeEvidenceResult(result: unknown): EvidenceResult {
  const normalized = normalizeString(result).toUpperCase();

  switch (normalized) {
    case "PASS":
      return "PASS";
    case "FAIL":
      return "FAIL";
    case "UNKNOWN":
      return "UNKNOWN";
    case "NOT_RUN":
    case "NOT RUN":
      return "NOT_RUN";
    case "NOT_APPLICABLE":
    case "NOT APPLICABLE":
      return "NOT_APPLICABLE";
    default:
      return "UNKNOWN";
  }
}

export function normalizeFindingSeverity(severity: unknown): FindingSeverity {
  const normalized = normalizeString(severity).toUpperCase();

  switch (normalized) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    case "INFO":
      return "INFO";
    default:
      return "MEDIUM";
  }
}

export function normalizeFindingCategory(category: unknown, provider?: string): FindingCategory {
  const normalized = normalizeString(category).toUpperCase();

  if (normalized.includes("SAST")) {
    return "SAST";
  }
  if (normalized.includes("SCA")) {
    return "SCA";
  }
  if (normalized.includes("SECRET")) {
    return "SECRET";
  }
  if (normalized.includes("DAST") || normalized.includes("WEB")) {
    return "DAST";
  }
  if (normalized.includes("CONTAINER")) {
    return "CONTAINER";
  }
  if (normalized.includes("IAC") || normalized.includes("INFRA")) {
    return "IAC";
  }
  if (normalized.includes("AI")) {
    return "AI_SECURITY";
  }
  if (provider?.toLowerCase().includes("snyk")) {
    return "SCA";
  }
  if (provider?.toLowerCase().includes("codeql")) {
    return "SAST";
  }

  return "OTHER";
}

export function normalizeSecurityFinding(raw: unknown, provider: string): SecurityFinding {
  const record = isPlainObject(raw) ? raw : { payload: raw };
  const providerFindingId =
    normalizeString(
      record["id"] ?? record["key"] ?? record["ruleId"] ?? record["checkId"] ?? record["guid"] ?? record["uuid"],
    ) ||
    normalizeString(record["title"] ?? record["name"]) ||
    `${provider}:${normalizeString(record["category"] ?? record["status"] ?? record["description"] ?? "unknown")}`;

  return {
    provider,
    providerFindingId,
    category: normalizeFindingCategory(record["category"] ?? record["type"], provider),
    severity: normalizeFindingSeverity(record["severity"] ?? record["priority"] ?? record["severityLevel"]),
    title: normalizeString(record["title"] ?? record["name"] ?? "Untitled finding"),
    description: normalizeString(record["description"] ?? record["summary"] ?? record["message"]) || undefined,
    file: normalizeString(record["file"] ?? record["path"]) || undefined,
    line:
      typeof record["line"] === "number" && Number.isFinite(record["line"])
        ? record["line"]
        : undefined,
    ruleId:
      normalizeString(record["ruleId"] ?? record["rule_key"] ?? record["ruleId"] ?? record["checkId"]) || undefined,
    status: normalizeString(record["status"] ?? record["state"] ?? "OPEN") || "OPEN",
    metadata: isPlainObject(raw) ? raw : { raw },
  };
}

export function createSecurityEvidence(
  type: EvidenceType,
  source: string,
  result: EvidenceResult,
  metadata?: Record<string, unknown>,
): SecurityEvidence {
  return {
    type,
    source,
    result,
    timestamp: new Date(),
    metadata,
  };
}

export function summarizeEvidence(evidence: SecurityEvidence[]): EvidenceSummary[] {
  const counts: Record<EvidenceResult, number> = {
    PASS: 0,
    FAIL: 0,
    UNKNOWN: 0,
    NOT_RUN: 0,
    NOT_APPLICABLE: 0,
  };

  for (const item of evidence) {
    counts[item.result] = counts[item.result] + 1;
  }

  return Object.entries(counts).map(([result, count]) => ({
    result: result as EvidenceResult,
    count,
  }));
}

/**
 * Provider registry and factory.
 * Manages security tool integrations.
 */

const providerRegistry: Map<string, SecurityProvider> = new Map();

/**
 * Register a security provider.
 * @param name Unique provider name
 * @param provider Provider implementation
 */
export function registerProvider(name: string, provider: SecurityProvider): void {
  if (providerRegistry.has(name)) {
    throw new Error(`Provider ${name} already registered`);
  }
  providerRegistry.set(name, provider);
}

/**
 * Get a registered security provider by name.
 * @param name Provider name
 * @returns Provider or undefined if not found
 */
export function getProvider(name: string): SecurityProvider | undefined {
  return providerRegistry.get(name);
}

/**
 * Get all registered providers.
 * @returns Map of provider names to implementations
 */
export function getProviders(): Map<string, SecurityProvider> {
  return new Map(providerRegistry);
}

/**
 * Remove a provider from the registry.
 * Useful for testing and dynamic provider management.
 * @param name Provider name
 */
export function unregisterProvider(name: string): boolean {
  return providerRegistry.delete(name);
}

/**
 * Clear all registered providers.
 * Useful for testing.
 */
export function clearProviders(): void {
  providerRegistry.clear();
}

/**
 * CodeQL mock provider.
 * Real implementation would execute CodeQL queries over the codebase.
 */
export const createCodeQLProvider = (): SecurityProvider => ({
  name: "CodeQL",
  analyze(): Promise<SecurityResult> {
    return Promise.resolve({
      findings: [],
      evidence: [
        createSecurityEvidence("SAST", "CodeQL", "NOT_RUN", {
          reason: "CodeQL integration not configured",
          contact: "security-team",
        }),
      ],
    });
  },
  getFindings(): Promise<SecurityFinding[]> {
    return Promise.resolve([]);
  },
});

/**
 * Semgrep mock provider.
 * Real implementation would run Semgrep rulesets.
 */
export const createSemgrepProvider = (): SecurityProvider => ({
  name: "Semgrep",
  analyze(): Promise<SecurityResult> {
    return Promise.resolve({
      findings: [],
      evidence: [
        createSecurityEvidence("SAST", "Semgrep", "NOT_RUN", {
          reason: "Semgrep integration not configured",
          contact: "security-team",
        }),
      ],
    });
  },
  getFindings(): Promise<SecurityFinding[]> {
    return Promise.resolve([]);
  },
});

/**
 * Snyk mock provider.
 * Real implementation would query Snyk API for dependencies.
 */
export const createSnykProvider = (): SecurityProvider => ({
  name: "Snyk",
  analyze(): Promise<SecurityResult> {
    return Promise.resolve({
      findings: [],
      evidence: [
        createSecurityEvidence("SCA", "Snyk", "NOT_RUN", {
          reason: "Snyk integration not configured",
          contact: "security-team",
        }),
      ],
    });
  },
  getFindings(): Promise<SecurityFinding[]> {
    return Promise.resolve([]);
  },
});

/**
 * Sonar mock provider.
 * Real implementation would query Sonar API for code quality and security.
 */
export const createSonarProvider = (): SecurityProvider => ({
  name: "Sonar",
  analyze(): Promise<SecurityResult> {
    return Promise.resolve({
      findings: [],
      evidence: [
        createSecurityEvidence("SAST", "Sonar", "NOT_RUN", {
          reason: "Sonar integration not configured",
          contact: "security-team",
        }),
      ],
    });
  },
  getFindings(): Promise<SecurityFinding[]> {
    return Promise.resolve([]);
  },
});

/**
 * Phase 11: AI Change Passport
 * Central derived artifact consolidating all security evidence into a unified record.
 */

export type PassportStatus =
  | "DRAFT"
  | "APPROVED"
  | "APPROVED_WITH_CONDITIONS"
  | "REVIEW_REQUIRED"
  | "BLOCKED"
  | "PENDING_APPROVAL"
  | "REJECTED";

export interface AIProvenanceInfo {
  involvement: "YES" | "NO" | "UNKNOWN";
  agent?: string;
  model?: string;
  confidence: number;
  source: string;
}

export interface ChangedFileInfo {
  filePath: string;
  sensitiveAreas: string[];
  additions: number;
  deletions: number;
}

export interface RiskInfo {
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  modelVersion: string;
  factors?: Record<string, unknown>;
  explanation?: string;
}

export interface PolicyInfo {
  action: "ALLOW" | "REVIEW" | "BLOCK";
  matchedRuleIds: string[];
  requiredApprovals: string[];
  explanation?: string;
}

export interface ReviewInfo {
  reviewerId?: string;
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  status: "PENDING" | "COMPLETED";
  comment?: string;
}

export interface FindingsSummary {
  total: number;
  bySeverity: Record<FindingSeverity, number>;
  byCategory: Record<FindingCategory, number>;
}

export interface PassportSection {
  name: string;
  status: "PASS" | "FAIL" | "UNKNOWN" | "NOT_RUN" | "REVIEW_REQUIRED";
  detail?: string;
}

export interface AIChangePassport {
  id: string;
  organizationId: string;
  pullRequestId?: string;
  repositoryName?: string;
  prNumber?: number;
  prTitle?: string;
  author?: string;
  status: PassportStatus;
  createdAt: Date;
  updatedAt: Date;
  aiProvenance?: AIProvenanceInfo;
  changedFiles: ChangedFileInfo[];
  risk?: RiskInfo;
  policy?: PolicyInfo;
  reviews: ReviewInfo[];
  findingsSummary?: FindingsSummary;
  evidenceSummary?: EvidenceSummary[];
  overallFinding: EvidenceResult;
  explanation: string;
  sections: PassportSection[];
}

/**
 * Build an AI Change Passport from component security records.
 * This is the primary function for deriving the passport from database evidence.
 *
 * @param passportId Unique passport identifier
 * @param organizationId Organization scope
 * @param pr PR metadata (prNumber, title, author, repository)
 * @param aiActivity AI provenance from Phase 5
 * @param codeChanges Changed files from Phase 6 classification
 * @param riskAssessment Risk scoring from Phase 7
 * @param policyDecision Policy evaluation from Phase 8
 * @param findings Security findings (aggregated)
 * @param evidence Security evidence (aggregated)
 * @param reviews Human reviews
 * @returns Complete AI Change Passport
 */
export function deriveChangePassport(
  passportId: string,
  organizationId: string,
  pr: {
    pullRequestId?: string;
    number?: number;
    title?: string;
    author?: string;
    repositoryName?: string;
  },
  aiActivity?: {
    involvement: "YES" | "NO" | "UNKNOWN";
    agent?: string;
    model?: string;
    confidence: number;
    source: string;
  },
  codeChanges?: Array<{
    filePath: string;
    sensitiveAreas: string[];
    additions: number;
    deletions: number;
  }>,
  riskAssessment?: {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    modelVersion: string;
    factors?: Record<string, unknown>;
    explanation?: string;
  },
  policyDecision?: {
    action: "ALLOW" | "REVIEW" | "BLOCK";
    matchedRuleIds: string[];
    requiredApprovals: string[];
    explanation?: string;
  },
  findings?: Array<{
    severity: FindingSeverity;
    category: FindingCategory;
    title: string;
  }>,
  evidence?: EvidenceSummary[],
  reviews?: Array<{
    decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
    status: "PENDING" | "COMPLETED";
    comment?: string;
  }>,
): AIChangePassport {
  const now = new Date();
  const changedFiles = codeChanges ?? [];

  // Calculate findings summary
  const findingsSummary = findings
    ? buildFindingsSummary(findings)
    : undefined;

  // Build sections for passport
  const sections: PassportSection[] = [];

  if (aiActivity) {
    sections.push({
      name: "AI Provenance",
      status:
        aiActivity.involvement === "YES"
          ? "PASS"
          : aiActivity.involvement === "UNKNOWN"
            ? "UNKNOWN"
            : "PASS",
      detail: `${aiActivity.agent ?? "Unknown agent"} (${(aiActivity.confidence * 100).toFixed(0)}% confidence)`,
    });
  }

  if (changedFiles.length > 0) {
    const sensitiveCounts = countSensitiveAreas(changedFiles);
    const hasHighRiskChanges = sensitiveCounts.size > 0;
    sections.push({
      name: "Sensitive Areas",
      status: hasHighRiskChanges ? "REVIEW_REQUIRED" : "PASS",
      detail: Array.from(sensitiveCounts.keys()).join(", ") || "None",
    });
  }

  if (riskAssessment) {
    sections.push({
      name: "Risk Assessment",
      status:
        riskAssessment.level === "LOW"
          ? "PASS"
          : riskAssessment.level === "CRITICAL"
            ? "FAIL"
            : "REVIEW_REQUIRED",
      detail: `${riskAssessment.level} (score: ${riskAssessment.score.toFixed(1)})`,
    });
  }

  if (policyDecision) {
    sections.push({
      name: "Policy Evaluation",
      status:
        policyDecision.action === "BLOCK"
          ? "FAIL"
          : policyDecision.action === "REVIEW"
            ? "REVIEW_REQUIRED"
            : "PASS",
      detail: policyDecision.action,
    });
  }

  if (evidence && evidence.length > 0) {
    const failCount = evidence.find((e) => e.result === "FAIL")?.count ?? 0;
    const unknownCount = evidence.find((e) => e.result === "UNKNOWN")?.count ?? 0;
    sections.push({
      name: "Security Evidence",
      status: failCount > 0 ? "FAIL" : unknownCount > 0 ? "UNKNOWN" : "PASS",
      detail: `${evidence.find((e) => e.result === "PASS")?.count ?? 0} passed, ${failCount} failed, ${unknownCount} unknown`,
    });
  }

  // Calculate overall status and finding
  const overallStatus = calculatePassportStatus(
    policyDecision?.action,
    riskAssessment?.level,
    reviews,
  );
  const overallFinding = calculateOverallFinding(
    policyDecision?.action,
    riskAssessment?.level,
    evidence,
  );
  const explanation = buildExplanation(
    aiActivity,
    riskAssessment,
    policyDecision,
    overallStatus,
  );

  return {
    id: passportId,
    organizationId,
    pullRequestId: pr.pullRequestId,
    prNumber: pr.number,
    prTitle: pr.title,
    author: pr.author,
    repositoryName: pr.repositoryName,
    status: overallStatus,
    createdAt: now,
    updatedAt: now,
    aiProvenance: aiActivity,
    changedFiles,
    risk: riskAssessment,
    policy: policyDecision,
    reviews: reviews ?? [],
    findingsSummary,
    evidenceSummary: evidence,
    overallFinding,
    explanation,
    sections,
  };
}

/**
 * Calculate findings summary from a list of findings.
 */
function buildFindingsSummary(
  findings: Array<{ severity: FindingSeverity; category: FindingCategory }>,
): FindingsSummary {
  const severities: Record<FindingSeverity, number> = {
    INFO: 0,
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };

  const categories: Record<FindingCategory, number> = {
    SAST: 0,
    SCA: 0,
    SECRET: 0,
    DAST: 0,
    CONTAINER: 0,
    IAC: 0,
    MALICIOUS_DEPENDENCY: 0,
    AI_SECURITY: 0,
    OTHER: 0,
  };

  for (const finding of findings) {
    severities[finding.severity]++;
    categories[finding.category]++;
  }

  return {
    total: findings.length,
    bySeverity: severities,
    byCategory: categories,
  };
}

/**
 * Count unique sensitive areas across all changed files.
 */
function countSensitiveAreas(
  changedFiles: Array<{ sensitiveAreas: string[] }>,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const file of changedFiles) {
    for (const area of file.sensitiveAreas) {
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
  }

  return counts;
}

/**
 * Calculate passport status based on policy decision, risk level, and reviews.
 */
function calculatePassportStatus(
  policyAction?: "ALLOW" | "REVIEW" | "BLOCK",
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  reviews?: Array<{ decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" }>,
): PassportStatus {
  // Blocked takes precedence
  if (policyAction === "BLOCK") {
    return "BLOCKED";
  }

  // Check reviews
  const hasRejection = reviews?.some((r) => r.decision === "REJECTED");
  if (hasRejection) {
    return "REJECTED";
  }

  const allApproved = reviews && reviews.length > 0 && reviews.every((r) => r.decision === "APPROVED");
  if (allApproved && policyAction !== "REVIEW" && riskLevel !== "CRITICAL") {
    return "APPROVED";
  }

  // If approvals pending or policy review required
  if (policyAction === "REVIEW" || riskLevel === "CRITICAL") {
    const hasApprovals = reviews?.some((r) => r.decision === "APPROVED");
    if (hasApprovals && reviews?.every((r) => r.decision === "APPROVED")) {
      return "APPROVED_WITH_CONDITIONS";
    }
    return "REVIEW_REQUIRED";
  }

  // Default: approved if no issues
  return allApproved ? "APPROVED" : policyAction === "ALLOW" ? "APPROVED" : "PENDING_APPROVAL";
}

/**
 * Calculate overall finding result.
 */
function calculateOverallFinding(
  policyAction?: "ALLOW" | "REVIEW" | "BLOCK",
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  evidence?: EvidenceSummary[],
): EvidenceResult {
  // If blocked, result is FAIL
  if (policyAction === "BLOCK") {
    return "FAIL";
  }

  // If critical risk, need review (UNKNOWN until reviewed)
  if (riskLevel === "CRITICAL") {
    return "UNKNOWN";
  }

  // Check evidence
  if (evidence) {
    const failCount = evidence.find((e) => e.result === "FAIL")?.count ?? 0;
    const unknownCount = evidence.find((e) => e.result === "UNKNOWN")?.count ?? 0;

    if (failCount > 0) {
      return "FAIL";
    }
    if (unknownCount > 0) {
      return "UNKNOWN";
    }
  }

  // Default: PASS
  return "PASS";
}

/**
 * Build human-readable explanation of passport status.
 */
function buildExplanation(
  aiActivity?: { involvement: string; agent?: string; confidence: number },
  riskAssessment?: { level: string; score: number; explanation?: string },
  policyDecision?: { action: string; explanation?: string },
  status?: PassportStatus,
): string {
  const parts: string[] = [];

  if (aiActivity) {
    parts.push(
      `AI ${aiActivity.involvement} (${aiActivity.agent ?? "unknown"}, ${(aiActivity.confidence * 100).toFixed(0)}% confidence)`,
    );
  }

  if (riskAssessment) {
    parts.push(`Risk: ${riskAssessment.level}`);
  }

  if (policyDecision) {
    parts.push(`Policy: ${policyDecision.action}`);
  }

  if (status === "APPROVED") {
    parts.push("— APPROVED");
  } else if (status === "BLOCKED") {
    parts.push("— BLOCKED");
  } else if (status === "REVIEW_REQUIRED") {
    parts.push("— REVIEW REQUIRED");
  }

  return parts.join(" | ");
}

/**
 * Format a Change Passport for human display (text/markdown).
 */
export function formatPassportForDisplay(passport: AIChangePassport): string {
  const lines: string[] = [
    "╭─────────────────────────────────╮",
    "│ AI CHANGE PASSPORT              │",
    "╰─────────────────────────────────╯",
    "",
  ];

  if (passport.repositoryName || passport.prNumber) {
    lines.push("CHANGE LOCATION");
    if (passport.repositoryName) {
      lines.push(`Repository: ${passport.repositoryName}`);
    }
    if (passport.prNumber) {
      lines.push(`PR #${passport.prNumber}`);
    }
    if (passport.prTitle) {
      lines.push(`Title: ${passport.prTitle}`);
    }
    if (passport.author) {
      lines.push(`Author: ${passport.author}`);
    }
    lines.push("");
  }

  if (passport.aiProvenance) {
    lines.push("AI INVOLVEMENT");
    lines.push(`Status: ${passport.aiProvenance.involvement}`);
    if (passport.aiProvenance.agent) {
      lines.push(`Agent: ${passport.aiProvenance.agent}`);
    }
    if (passport.aiProvenance.model) {
      lines.push(`Model: ${passport.aiProvenance.model}`);
    }
    lines.push(`Confidence: ${(passport.aiProvenance.confidence * 100).toFixed(0)}%`);
    lines.push(`Source: ${passport.aiProvenance.source}`);
    lines.push("");
  }

  if (passport.changedFiles.length > 0) {
    lines.push("CHANGED FILES");
    const sensitiveAreaSet = new Set<string>();
    for (const file of passport.changedFiles) {
      for (const area of file.sensitiveAreas) {
        sensitiveAreaSet.add(area);
      }
    }
    lines.push(`Total: ${passport.changedFiles.length} files`);
    if (sensitiveAreaSet.size > 0) {
      lines.push(`Sensitive areas: ${Array.from(sensitiveAreaSet).join(", ")}`);
    }
    lines.push("");
  }

  if (passport.risk) {
    lines.push("RISK");
    lines.push(`Level: ${passport.risk.level}`);
    lines.push(`Score: ${passport.risk.score.toFixed(1)}`);
    lines.push(`Model: ${passport.risk.modelVersion}`);
    if (passport.risk.explanation) {
      lines.push(`Explanation: ${passport.risk.explanation}`);
    }
    lines.push("");
  }

  if (passport.policy) {
    lines.push("POLICY");
    lines.push(`Action: ${passport.policy.action}`);
    if (passport.policy.requiredApprovals.length > 0) {
      lines.push(`Required approvals: ${passport.policy.requiredApprovals.join(", ")}`);
    }
    if (passport.policy.explanation) {
      lines.push(`Explanation: ${passport.policy.explanation}`);
    }
    lines.push("");
  }

  if (passport.reviews.length > 0) {
    lines.push("REVIEWS");
    for (const review of passport.reviews) {
      lines.push(`${review.decision}: ${review.status}`);
      if (review.comment) {
        lines.push(`  Comment: ${review.comment}`);
      }
    }
    lines.push("");
  }

  lines.push("STATUS");
  lines.push(`Overall: ${passport.status}`);
  lines.push(`Finding: ${passport.overallFinding}`);
  lines.push(`Summary: ${passport.explanation}`);
  lines.push("");

  return lines.join("\n");
}

export const SECURITY_PACKAGE_VERSION = "0.1.0";
