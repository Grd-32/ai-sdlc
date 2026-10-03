/**
 * Deterministic risk engine package.
 * Phase 6+: sensitive-area classification and later deterministic risk scoring.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RepositoryCriticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type SensitiveArea =
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "PAYMENTS"
  | "CRYPTOGRAPHY"
  | "SECRETS"
  | "DATABASE"
  | "PERSONAL_DATA"
  | "INFRASTRUCTURE"
  | "NETWORKING"
  | "API"
  | "DEPENDENCIES"
  | "CI_CD"
  | "CONTAINERS"
  | "LOGGING"
  | "FRONTEND"
  | "TESTING"
  | "DOCUMENTATION";

export type EvidenceResult = "PASS" | "FAIL" | "UNKNOWN" | "NOT_RUN" | "NOT_APPLICABLE";

export interface SecurityFindingSummary {
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  count: number;
}

export interface EvidenceSummary {
  result: EvidenceResult;
  count: number;
}

export interface RiskAssessmentInput {
  repositoryCriticality: RepositoryCriticality;
  aiInvolvement: "YES" | "NO" | "UNKNOWN";
  aiConfidence: number;
  sensitiveAreas: SensitiveArea[];
  additions: number;
  deletions: number;
  changedFiles?: number;
  newDependencies?: number;
  securityFindings?: SecurityFindingSummary[];
  evidenceSummary?: EvidenceSummary[];
}

const SENSITIVE_AREA_RULES: Array<{
  area: SensitiveArea;
  patterns: RegExp[];
}> = [
  {
    area: "AUTHENTICATION",
    patterns: [/\bauth\b/i, /authentication/i, /session/i, /login/i, /signin/i, /signup/i],
  },
  {
    area: "AUTHORIZATION",
    patterns: [/authorization/i, /authorize/i, /permission/i, /access-control/i, /rbac/i, /roles?\b/i],
  },
  {
    area: "PAYMENTS",
    patterns: [/payment/i, /checkout/i, /refund/i, /invoice/i, /billing/i, /transactions?/i],
  },
  {
    area: "CRYPTOGRAPHY",
    patterns: [/crypto/i, /encryption/i, /decryption/i, /hashing/i, /tls/i, /ssl/i],
  },
  {
    area: "SECRETS",
    patterns: [/secret/i, /password/i, /credential/i, /key\b/i, /token/i, /vault/i],
  },
  {
    area: "DATABASE",
    patterns: [/prisma/i, /db\b/i, /database/i, /sql/i, /migrations?/i, /postgres/i, /mongodb/i],
  },
  {
    area: "PERSONAL_DATA",
    patterns: [/personal/i, /pii/i, /user_data/i, /customer_data/i, /ssn/i, /dob/i, /personal_data/i],
  },
  {
    area: "INFRASTRUCTURE",
    patterns: [/terraform/i, /cloudformation/i, /k8s/i, /helm/i, /infrastructure/i, /infra/i, /deployment/i],
  },
  {
    area: "NETWORKING",
    patterns: [/network/i, /socket/i, /tcp/i, /udp/i, /firewall/i, /http/i, /https/i],
  },
  {
    area: "API",
    patterns: [/\bapi\b/i, /endpoint/i, /route/i, /controller/i, /handler/i],
  },
  {
    area: "DEPENDENCIES",
    patterns: [/package\.json/i, /pnpm-lock\.yaml/i, /package-lock\.json/i, /yarn\.lock/i, /dependencies?/i],
  },
  {
    area: "CI_CD",
    patterns: [/github\/workflows/i, /\.github\/workflows/i, /ci\/|\.circleci\//i, /jenkinsfile/i, /azure-pipelines\.yml/i, /pipeline/i],
  },
  {
    area: "CONTAINERS",
    patterns: [/dockerfile/i, /docker-compose/i, /\.dockerignore/i, /container/i, /k8s\/|helm\//i],
  },
  {
    area: "LOGGING",
    patterns: [/log(?:ger)?/i, /tracing/i, /audit/i, /sentry/i],
  },
  {
    area: "FRONTEND",
    patterns: [/\bui\b/i, /components?\//i, /pages\//i, /app\//i, /styles?\//i, /\.tsx$/i, /\.jsx$/i],
  },
  {
    area: "TESTING",
    patterns: [/__tests__\//i, /\.test\.tsx?$/i, /\.spec\.tsx?$/i, /jest/i, /vitest/i, /playwright/i, /cypress/i],
  },
  {
    area: "DOCUMENTATION",
    patterns: [/docs?\//i, /README\.md/i, /CHANGELOG/i, /\.md$/i],
  },
];

export interface RiskFactor {
  name: string;
  weight: number;
  description?: string;
}

export interface RiskAssessmentResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  explanation: string;
  modelVersion: string;
}

const REPOSITORY_CRITICALITY_WEIGHTS: Record<RepositoryCriticality, number> = {
  LOW: 0,
  MEDIUM: 10,
  HIGH: 20,
  CRITICAL: 30,
};

const SENSITIVE_AREA_WEIGHTS: Record<SensitiveArea, number> = {
  AUTHENTICATION: 12,
  AUTHORIZATION: 12,
  PAYMENTS: 12,
  CRYPTOGRAPHY: 12,
  SECRETS: 12,
  DATABASE: 9,
  PERSONAL_DATA: 10,
  INFRASTRUCTURE: 10,
  NETWORKING: 8,
  API: 8,
  DEPENDENCIES: 8,
  CI_CD: 7,
  CONTAINERS: 7,
  LOGGING: 5,
  FRONTEND: 4,
  TESTING: 4,
  DOCUMENTATION: 2,
};

function sanitizeNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreSensitiveAreas(areas: SensitiveArea[]): number {
  const uniqueAreas = new Set(areas);
  let score = 0;

  for (const area of uniqueAreas) {
    score += SENSITIVE_AREA_WEIGHTS[area];
  }

  return Math.min(40, score);
}

function scoreChangeSize(additions: number, deletions: number, changedFiles?: number): number {
  const total = sanitizeNumber(additions) + sanitizeNumber(deletions);
  const fileMultiplier = changedFiles ? Math.min(1.5, 1 + sanitizeNumber(changedFiles) / 20) : 1;
  return Math.min(20, Math.sqrt(total) * 2 * fileMultiplier);
}

function scoreNewDependencies(count?: number): number {
  const safeCount = sanitizeNumber(count ?? 0);
  return safeCount > 0 ? Math.min(15, safeCount * 6) : 0;
}

function scoreSecurityFindings(findings?: SecurityFindingSummary[]): number {
  if (!findings || findings.length === 0) {
    return 0;
  }

  const severityWeights: Record<SecurityFindingSummary["severity"], number> = {
    INFO: 0,
    LOW: 4,
    MEDIUM: 8,
    HIGH: 16,
    CRITICAL: 24,
  };

  return Math.min(
    30,
    findings.reduce((sum, finding) => sum + severityWeights[finding.severity] * sanitizeNumber(finding.count), 0),
  );
}

function scoreEvidenceSummary(evidence?: EvidenceSummary[]): number {
  if (!evidence || evidence.length === 0) {
    return 0;
  }

  const resultWeights: Record<EvidenceResult, number> = {
    PASS: 0,
    FAIL: 10,
    UNKNOWN: 5,
    NOT_RUN: 5,
    NOT_APPLICABLE: 0,
  };

  return Math.min(
    20,
    evidence.reduce((sum, item) => sum + resultWeights[item.result] * sanitizeNumber(item.count), 0),
  );
}

function scoreAIInvolvement(involvement: "YES" | "NO" | "UNKNOWN", confidence: number): number {
  const normalizedConfidence = Math.max(0, Math.min(1, confidence));

  if (involvement === "YES") {
    return 35 + normalizedConfidence * 25;
  }

  if (involvement === "UNKNOWN") {
    return 10 + normalizedConfidence * 10;
  }

  return 0;
}

export function evaluateRisk(input: RiskAssessmentInput): RiskAssessmentResult {
  const aiScore = scoreAIInvolvement(input.aiInvolvement, input.aiConfidence);
  const criticalityScore = REPOSITORY_CRITICALITY_WEIGHTS[input.repositoryCriticality];
  const sensitiveAreaScore = scoreSensitiveAreas(input.sensitiveAreas);
  const changeSizeScore = scoreChangeSize(input.additions, input.deletions, input.changedFiles);
  const dependencyScore = scoreNewDependencies(input.newDependencies);
  const findingScore = scoreSecurityFindings(input.securityFindings);
  const evidenceScore = scoreEvidenceSummary(input.evidenceSummary);

  const rawScore =
    aiScore +
    criticalityScore +
    sensitiveAreaScore +
    changeSizeScore +
    dependencyScore +
    findingScore +
    evidenceScore;

  const score = clampScore(rawScore);
  const level: RiskLevel = score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";

  const factors: RiskFactor[] = [
    {
      name: "AI involvement",
      weight: Math.round(aiScore),
      description: `Involvement=${input.aiInvolvement}, confidence=${input.aiConfidence}`,
    },
    {
      name: "Repository criticality",
      weight: criticalityScore,
      description: input.repositoryCriticality,
    },
    {
      name: "Sensitive areas",
      weight: sensitiveAreaScore,
      description: input.sensitiveAreas.join(", ") || "none",
    },
    {
      name: "Change size",
      weight: Math.round(changeSizeScore),
      description: `additions=${input.additions} deletions=${input.deletions}`,
    },
    {
      name: "New dependencies",
      weight: dependencyScore,
      description: `count=${input.newDependencies ?? 0}`,
    },
    {
      name: "Security findings",
      weight: findingScore,
      description:
        String(input.securityFindings?.reduce((sum, f) => sum + sanitizeNumber(f.count), 0) ?? 0) + " findings",
    },
    {
      name: "Evidence uncertainty",
      weight: evidenceScore,
      description: input.evidenceSummary
        ? input.evidenceSummary.map((item) => `${item.result}:${item.count}`).join(", ")
        : "none",
    },
  ];

  const explanation = `risk-v1 computed from AI involvement (${input.aiInvolvement}), repository criticality (${input.repositoryCriticality}), ${input.sensitiveAreas.length} sensitive areas, change size ${input.additions}+${input.deletions}, ${input.newDependencies ?? 0} new dependencies, security findings ${input.securityFindings?.length ?? 0}, evidence signals ${input.evidenceSummary?.length ?? 0}.`;

  return {
    score,
    level,
    factors,
    explanation,
    modelVersion: RISK_MODEL_VERSION,
  };
}

export function classifyFilePath(filePath: string): SensitiveArea[] {
  const normalized = filePath.trim().replace(/\\\\/g, "/").toLowerCase();
  const areas = new Set<SensitiveArea>();

  for (const rule of SENSITIVE_AREA_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        areas.add(rule.area);
        break;
      }
    }
  }

  return [...areas];
}

export function classifyFilePaths(filePaths: string[]): SensitiveArea[] {
  const areas = new Set<SensitiveArea>();

  for (const filePath of filePaths) {
    classifyFilePath(filePath).forEach((area) => areas.add(area));
  }

  return [...areas];
}

export const RISK_MODEL_VERSION = "risk-v1";

export const RISK_PACKAGE_VERSION = "0.1.0";
