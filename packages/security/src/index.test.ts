import { describe, it, expect, beforeEach } from "vitest";
import {
  SECURITY_PACKAGE_VERSION,
  normalizeEvidenceResult,
  normalizeFindingSeverity,
  normalizeFindingCategory,
  normalizeSecurityFinding,
  createSecurityEvidence,
  summarizeEvidence,
  registerProvider,
  getProvider,
  getProviders,
  unregisterProvider,
  clearProviders,
  createCodeQLProvider,
  createSemgrepProvider,
  createSnykProvider,
  createSonarProvider,
  deriveChangePassport,
  formatPassportForDisplay,
} from "./index.js";

describe("@ai-sdlc/security", () => {
  it("exports package version", () => {
    expect(SECURITY_PACKAGE_VERSION).toBe("0.1.0");
  });
});

describe("normalizeEvidenceResult", () => {
  it("returns PASS for 'PASS'", () => {
    expect(normalizeEvidenceResult("PASS")).toBe("PASS");
  });

  it("returns FAIL for 'FAIL'", () => {
    expect(normalizeEvidenceResult("FAIL")).toBe("FAIL");
  });

  it("returns UNKNOWN for 'UNKNOWN'", () => {
    expect(normalizeEvidenceResult("UNKNOWN")).toBe("UNKNOWN");
  });

  it("returns NOT_RUN for 'NOT_RUN'", () => {
    expect(normalizeEvidenceResult("NOT_RUN")).toBe("NOT_RUN");
  });

  it("returns NOT_RUN for 'NOT RUN' (with space)", () => {
    expect(normalizeEvidenceResult("NOT RUN")).toBe("NOT_RUN");
  });

  it("returns NOT_APPLICABLE for 'NOT_APPLICABLE'", () => {
    expect(normalizeEvidenceResult("NOT_APPLICABLE")).toBe("NOT_APPLICABLE");
  });

  it("returns NOT_APPLICABLE for 'NOT APPLICABLE' (with space)", () => {
    expect(normalizeEvidenceResult("NOT APPLICABLE")).toBe("NOT_APPLICABLE");
  });

  it("returns UNKNOWN for unrecognized string", () => {
    expect(normalizeEvidenceResult("INVALID")).toBe("UNKNOWN");
  });

  it("is case-insensitive", () => {
    expect(normalizeEvidenceResult("pass")).toBe("PASS");
    expect(normalizeEvidenceResult("FaIl")).toBe("FAIL");
  });

  it("trims whitespace", () => {
    expect(normalizeEvidenceResult("  PASS  ")).toBe("PASS");
  });

  it("returns UNKNOWN for number input", () => {
    expect(normalizeEvidenceResult(123)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for null", () => {
    expect(normalizeEvidenceResult(null)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for undefined", () => {
    expect(normalizeEvidenceResult(undefined)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for object input", () => {
    expect(normalizeEvidenceResult({})).toBe("UNKNOWN");
  });
});

describe("normalizeFindingSeverity", () => {
  it("returns CRITICAL for 'CRITICAL'", () => {
    expect(normalizeFindingSeverity("CRITICAL")).toBe("CRITICAL");
  });

  it("returns HIGH for 'HIGH'", () => {
    expect(normalizeFindingSeverity("HIGH")).toBe("HIGH");
  });

  it("returns MEDIUM for 'MEDIUM'", () => {
    expect(normalizeFindingSeverity("MEDIUM")).toBe("MEDIUM");
  });

  it("returns LOW for 'LOW'", () => {
    expect(normalizeFindingSeverity("LOW")).toBe("LOW");
  });

  it("returns INFO for 'INFO'", () => {
    expect(normalizeFindingSeverity("INFO")).toBe("INFO");
  });

  it("is case-insensitive", () => {
    expect(normalizeFindingSeverity("critical")).toBe("CRITICAL");
    expect(normalizeFindingSeverity("MeDiUm")).toBe("MEDIUM");
  });

  it("trims whitespace", () => {
    expect(normalizeFindingSeverity("  HIGH  ")).toBe("HIGH");
  });

  it("returns MEDIUM as default for unrecognized value", () => {
    expect(normalizeFindingSeverity("UNKNOWN")).toBe("MEDIUM");
  });

  it("converts number to string and normalizes", () => {
    expect(normalizeFindingSeverity(123)).toBe("MEDIUM");
  });

  it("returns MEDIUM for null", () => {
    expect(normalizeFindingSeverity(null)).toBe("MEDIUM");
  });

  it("returns MEDIUM for undefined", () => {
    expect(normalizeFindingSeverity(undefined)).toBe("MEDIUM");
  });

  it("returns MEDIUM for object", () => {
    expect(normalizeFindingSeverity({})).toBe("MEDIUM");
  });
});

describe("normalizeFindingCategory", () => {
  it("returns SAST for 'SAST'", () => {
    expect(normalizeFindingCategory("SAST")).toBe("SAST");
  });

  it("returns SCA for 'SCA'", () => {
    expect(normalizeFindingCategory("SCA")).toBe("SCA");
  });

  it("returns SECRET for 'SECRET'", () => {
    expect(normalizeFindingCategory("SECRET")).toBe("SECRET");
  });

  it("returns DAST for 'DAST'", () => {
    expect(normalizeFindingCategory("DAST")).toBe("DAST");
  });

  it("returns DAST for 'WEB'", () => {
    expect(normalizeFindingCategory("WEB")).toBe("DAST");
  });

  it("returns CONTAINER for 'CONTAINER'", () => {
    expect(normalizeFindingCategory("CONTAINER")).toBe("CONTAINER");
  });

  it("returns IAC for 'IAC'", () => {
    expect(normalizeFindingCategory("IAC")).toBe("IAC");
  });

  it("returns IAC for 'INFRA'", () => {
    expect(normalizeFindingCategory("INFRA")).toBe("IAC");
  });

  it("returns AI_SECURITY for 'AI'", () => {
    expect(normalizeFindingCategory("AI")).toBe("AI_SECURITY");
  });

  it("returns OTHER for unrecognized category", () => {
    expect(normalizeFindingCategory("UNKNOWN")).toBe("OTHER");
  });

  it("infers SCA from Snyk provider", () => {
    expect(normalizeFindingCategory("something", "snyk")).toBe("SCA");
  });

  it("infers SAST from CodeQL provider", () => {
    expect(normalizeFindingCategory("something", "codeql")).toBe("SAST");
  });

  it("is case-insensitive", () => {
    expect(normalizeFindingCategory("sast")).toBe("SAST");
    expect(normalizeFindingCategory("SeCrEt")).toBe("SECRET");
  });

  it("prioritizes category over provider matching", () => {
    expect(normalizeFindingCategory("SAST", "snyk")).toBe("SAST");
  });

  it("trims whitespace", () => {
    expect(normalizeFindingCategory("  SAST  ")).toBe("SAST");
  });

  it("returns OTHER for null", () => {
    expect(normalizeFindingCategory(null)).toBe("OTHER");
  });

  it("returns OTHER for undefined", () => {
    expect(normalizeFindingCategory(undefined)).toBe("OTHER");
  });
});

describe("normalizeSecurityFinding", () => {
  it("normalizes a complete finding object", () => {
    const raw = {
      id: "CVE-2024-001",
      category: "SCA",
      severity: "HIGH",
      title: "Vulnerable dependency",
      description: "A vulnerable package found",
      file: "package.json",
      line: 42,
      ruleId: "npm-audit-001",
      status: "OPEN",
    };

    const result = normalizeSecurityFinding(raw, "snyk");

    expect(result.provider).toBe("snyk");
    expect(result.providerFindingId).toBe("CVE-2024-001");
    expect(result.category).toBe("SCA");
    expect(result.severity).toBe("HIGH");
    expect(result.title).toBe("Vulnerable dependency");
    expect(result.description).toBe("A vulnerable package found");
    expect(result.file).toBe("package.json");
    expect(result.line).toBe(42);
    expect(result.ruleId).toBe("npm-audit-001");
    expect(result.status).toBe("OPEN");
  });

  it("uses fallback fields for missing id", () => {
    const raw = {
      key: "semgrep-rule-001",
      title: "SQL Injection",
      category: "SAST",
      severity: "CRITICAL",
      status: "OPEN",
    };

    const result = normalizeSecurityFinding(raw, "semgrep");

    expect(result.providerFindingId).toBe("semgrep-rule-001");
  });

  it("falls back to title for providerFindingId", () => {
    const raw = {
      title: "Hardcoded password",
      category: "SECRET",
      severity: "CRITICAL",
      status: "OPEN",
    };

    const result = normalizeSecurityFinding(raw, "detect-secrets");

    expect(result.providerFindingId).toBe("Hardcoded password");
  });

  it("generates providerFindingId from category if id and title missing", () => {
    const raw = {
      category: "CONTAINER",
      severity: "MEDIUM",
      status: "OPEN",
    };

    const result = normalizeSecurityFinding(raw, "trivy");

    expect(result.providerFindingId).toContain("trivy");
    expect(result.providerFindingId).toContain("CONTAINER");
  });

  it("defaults to 'Untitled finding' for missing title", () => {
    const raw = {
      category: "SAST",
      severity: "LOW",
      status: "OPEN",
    };

    const result = normalizeSecurityFinding(raw, "codeql");

    expect(result.title).toBe("Untitled finding");
  });

  it("handles missing description", () => {
    const raw = {
      id: "rule-001",
      title: "Test finding",
      category: "SAST",
      severity: "MEDIUM",
      status: "OPEN",
    };

    const result = normalizeSecurityFinding(raw, "provider");

    expect(result.description).toBeUndefined();
  });

  it("handles missing file", () => {
    const raw = {
      id: "rule-001",
      title: "Test finding",
      category: "SAST",
      severity: "MEDIUM",
      status: "OPEN",
    };

    const result = normalizeSecurityFinding(raw, "provider");

    expect(result.file).toBeUndefined();
  });

  it("handles missing line number", () => {
    const raw = {
      id: "rule-001",
      title: "Test finding",
      category: "SAST",
      severity: "MEDIUM",
      status: "OPEN",
      file: "src/app.ts",
    };

    const result = normalizeSecurityFinding(raw, "provider");

    expect(result.line).toBeUndefined();
  });

  it("converts invalid line to undefined", () => {
    const raw = {
      id: "rule-001",
      title: "Test finding",
      category: "SAST",
      severity: "MEDIUM",
      status: "OPEN",
      line: "not-a-number",
    };

    const result = normalizeSecurityFinding(raw, "provider");

    expect(result.line).toBeUndefined();
  });

  it("defaults status to 'OPEN' if missing", () => {
    const raw = {
      id: "rule-001",
      title: "Test finding",
      category: "SAST",
      severity: "MEDIUM",
    };

    const result = normalizeSecurityFinding(raw, "provider");

    expect(result.status).toBe("OPEN");
  });

  it("handles non-object input", () => {
    const result = normalizeSecurityFinding("invalid raw data", "provider");

    expect(result.provider).toBe("provider");
    // Non-object input is wrapped in payload, so falls through to provider:unknown format
    expect(result.providerFindingId).toContain("provider:");
    expect(result.title).toBe("Untitled finding");
    expect(result.metadata).toEqual({ raw: "invalid raw data" });
  });

  it("normalizes field names from different providers", () => {
    const finding = {
      checkId: "check-001",
      priority: "high",
      name: "Security issue",
      summary: "A serious problem",
      path: "src/main.ts",
    };

    const result = normalizeSecurityFinding(finding, "provider");

    expect(result.providerFindingId).toBe("check-001");
    expect(result.severity).toBe("HIGH");
    expect(result.title).toBe("Security issue");
    expect(result.description).toBe("A serious problem");
    expect(result.file).toBe("src/main.ts");
  });

  it("normalizes severityLevel", () => {
    const raw = {
      id: "rule-001",
      title: "Issue",
      category: "SAST",
      severityLevel: "critical",
      status: "OPEN",
    };

    const result = normalizeSecurityFinding(raw, "provider");

    expect(result.severity).toBe("CRITICAL");
  });

  it("normalizes state field", () => {
    const raw = {
      id: "rule-001",
      title: "Issue",
      category: "SAST",
      severity: "MEDIUM",
      state: "RESOLVED",
    };

    const result = normalizeSecurityFinding(raw, "provider");

    expect(result.status).toBe("RESOLVED");
  });

  it("preserves complete metadata", () => {
    const raw = {
      id: "rule-001",
      title: "Issue",
      category: "SAST",
      severity: "MEDIUM",
      status: "OPEN",
      customField: "customValue",
      nestedData: { key: "value" },
    };

    const result = normalizeSecurityFinding(raw, "provider");

    expect(result.metadata).toEqual(raw);
  });
});

describe("createSecurityEvidence", () => {
  it("creates evidence with required fields", () => {
    const evidence = createSecurityEvidence("SAST", "CodeQL", "PASS");

    expect(evidence.type).toBe("SAST");
    expect(evidence.source).toBe("CodeQL");
    expect(evidence.result).toBe("PASS");
    expect(evidence.timestamp).toBeInstanceOf(Date);
    expect(evidence.metadata).toBeUndefined();
  });

  it("creates evidence with metadata", () => {
    const metadata = { checkId: "codeql/001", findings: 0 };
    const evidence = createSecurityEvidence("SCA", "Snyk", "FAIL", metadata);

    expect(evidence.type).toBe("SCA");
    expect(evidence.source).toBe("Snyk");
    expect(evidence.result).toBe("FAIL");
    expect(evidence.metadata).toEqual(metadata);
  });

  it("creates evidence with UNKNOWN result", () => {
    const evidence = createSecurityEvidence("TESTS", "Jest", "UNKNOWN");

    expect(evidence.result).toBe("UNKNOWN");
  });

  it("creates evidence with NOT_RUN result", () => {
    const evidence = createSecurityEvidence("CI", "GitHub Actions", "NOT_RUN");

    expect(evidence.result).toBe("NOT_RUN");
  });

  it("creates evidence with NOT_APPLICABLE result", () => {
    const evidence = createSecurityEvidence("HUMAN_REVIEW", "Security team", "NOT_APPLICABLE");

    expect(evidence.result).toBe("NOT_APPLICABLE");
  });

  it("sets timestamp to current time", () => {
    const before = new Date();
    const evidence = createSecurityEvidence("SAST", "test", "PASS");
    const after = new Date();

    expect(evidence.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(evidence.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe("summarizeEvidence", () => {
  it("counts evidence by result type", () => {
    const evidence = [
      createSecurityEvidence("SAST", "CodeQL", "PASS"),
      createSecurityEvidence("SCA", "Snyk", "PASS"),
      createSecurityEvidence("TESTS", "Jest", "FAIL"),
      createSecurityEvidence("CI", "GitHub", "UNKNOWN"),
    ];

    const summary = summarizeEvidence(evidence);

    const passSummary = summary.find((s) => s.result === "PASS");
    const failSummary = summary.find((s) => s.result === "FAIL");
    const unknownSummary = summary.find((s) => s.result === "UNKNOWN");

    expect(passSummary?.count).toBe(2);
    expect(failSummary?.count).toBe(1);
    expect(unknownSummary?.count).toBe(1);
  });

  it("returns all result types even with zero count", () => {
    const evidence = [createSecurityEvidence("SAST", "CodeQL", "PASS")];

    const summary = summarizeEvidence(evidence);

    expect(summary).toHaveLength(5);
    expect(summary.map((s) => s.result)).toContain("PASS");
    expect(summary.map((s) => s.result)).toContain("FAIL");
    expect(summary.map((s) => s.result)).toContain("UNKNOWN");
    expect(summary.map((s) => s.result)).toContain("NOT_RUN");
    expect(summary.map((s) => s.result)).toContain("NOT_APPLICABLE");
  });

  it("handles empty evidence array", () => {
    const summary = summarizeEvidence([]);

    const passSummary = summary.find((s) => s.result === "PASS");
    const failSummary = summary.find((s) => s.result === "FAIL");

    expect(passSummary?.count).toBe(0);
    expect(failSummary?.count).toBe(0);
  });

  it("correctly aggregates multiple evidence of same type", () => {
    const evidence = [
      createSecurityEvidence("SAST", "CodeQL", "FAIL"),
      createSecurityEvidence("SAST", "Semgrep", "FAIL"),
      createSecurityEvidence("SCA", "Snyk", "FAIL"),
    ];

    const summary = summarizeEvidence(evidence);

    const failSummary = summary.find((s) => s.result === "FAIL");

    expect(failSummary?.count).toBe(3);
  });

  it("handles all result types", () => {
    const evidence: Array<ReturnType<typeof createSecurityEvidence>> = [
      createSecurityEvidence("SAST", "a", "PASS"),
      createSecurityEvidence("SCA", "b", "FAIL"),
      createSecurityEvidence("TESTS", "c", "UNKNOWN"),
      createSecurityEvidence("CI", "d", "NOT_RUN"),
      createSecurityEvidence("HUMAN_REVIEW", "e", "NOT_APPLICABLE"),
    ];

    const summary = summarizeEvidence(evidence);

    expect(summary).toHaveLength(5);
    expect(summary.find((s) => s.result === "PASS")?.count).toBe(1);
    expect(summary.find((s) => s.result === "FAIL")?.count).toBe(1);
    expect(summary.find((s) => s.result === "UNKNOWN")?.count).toBe(1);
    expect(summary.find((s) => s.result === "NOT_RUN")?.count).toBe(1);
    expect(summary.find((s) => s.result === "NOT_APPLICABLE")?.count).toBe(1);
  });
});

describe("Provider Registry", () => {
  beforeEach(() => {
    clearProviders();
  });

  it("allows registering a provider", () => {
    const provider = createCodeQLProvider();
    registerProvider("codeql", provider);

    expect(getProvider("codeql")).toBe(provider);
  });

  it("throws error when registering duplicate provider", () => {
    const provider = createCodeQLProvider();
    registerProvider("codeql", provider);

    expect(() => {
      registerProvider("codeql", provider);
    }).toThrow("Provider codeql already registered");
  });

  it("returns undefined for unregistered provider", () => {
    expect(getProvider("nonexistent")).toBeUndefined();
  });

  it("returns all registered providers", () => {
    const codeql = createCodeQLProvider();
    const semgrep = createSemgrepProvider();

    registerProvider("codeql", codeql);
    registerProvider("semgrep", semgrep);

    const providers = getProviders();

    expect(providers.size).toBe(2);
    expect(providers.get("codeql")).toBe(codeql);
    expect(providers.get("semgrep")).toBe(semgrep);
  });

  it("unregisters a provider", () => {
    const provider = createCodeQLProvider();
    registerProvider("codeql", provider);

    expect(getProvider("codeql")).toBeDefined();

    const removed = unregisterProvider("codeql");

    expect(removed).toBe(true);
    expect(getProvider("codeql")).toBeUndefined();
  });

  it("returns false when unregistering non-existent provider", () => {
    const removed = unregisterProvider("nonexistent");

    expect(removed).toBe(false);
  });

  it("clears all providers", () => {
    registerProvider("codeql", createCodeQLProvider());
    registerProvider("semgrep", createSemgrepProvider());
    registerProvider("snyk", createSnykProvider());

    expect(getProviders().size).toBe(3);

    clearProviders();

    expect(getProviders().size).toBe(0);
  });
});

describe("Mock Provider Implementations", () => {
  beforeEach(() => {
    clearProviders();
  });

  it("CodeQL provider returns NOT_RUN evidence", async () => {
    const provider = createCodeQLProvider();

    expect(provider.name).toBe("CodeQL");

    const result = await provider.analyze("");

    expect(result.findings).toHaveLength(0);
    expect(result.evidence).toHaveLength(1);
    const firstEvidence = result.evidence.at(0);
    expect(firstEvidence?.result).toBe("NOT_RUN");
    expect(firstEvidence?.source).toBe("CodeQL");
    expect(firstEvidence?.type).toBe("SAST");

    const findings = await provider.getFindings("");

    expect(findings).toHaveLength(0);
  });

  it("Semgrep provider returns NOT_RUN evidence", async () => {
    const provider = createSemgrepProvider();

    expect(provider.name).toBe("Semgrep");

    const result = await provider.analyze("");

    expect(result.findings).toHaveLength(0);
    expect(result.evidence).toHaveLength(1);
    const firstEvidence = result.evidence.at(0);
    expect(firstEvidence?.result).toBe("NOT_RUN");
    expect(firstEvidence?.source).toBe("Semgrep");
    expect(firstEvidence?.type).toBe("SAST");
  });

  it("Snyk provider returns NOT_RUN evidence", async () => {
    const provider = createSnykProvider();

    expect(provider.name).toBe("Snyk");

    const result = await provider.analyze("");

    expect(result.findings).toHaveLength(0);
    expect(result.evidence).toHaveLength(1);
    const firstEvidence = result.evidence.at(0);
    expect(firstEvidence?.result).toBe("NOT_RUN");
    expect(firstEvidence?.source).toBe("Snyk");
    expect(firstEvidence?.type).toBe("SCA");
  });

  it("Sonar provider returns NOT_RUN evidence", async () => {
    const provider = createSonarProvider();

    expect(provider.name).toBe("Sonar");

    const result = await provider.analyze("");

    expect(result.findings).toHaveLength(0);
    expect(result.evidence).toHaveLength(1);
    const firstEvidence = result.evidence.at(0);
    expect(firstEvidence?.result).toBe("NOT_RUN");
    expect(firstEvidence?.source).toBe("Sonar");
    expect(firstEvidence?.type).toBe("SAST");
  });
});

describe("Provider Integration", () => {
  beforeEach(() => {
    clearProviders();
  });

  it("registers and uses multiple providers", async () => {
    registerProvider("codeql", createCodeQLProvider());
    registerProvider("semgrep", createSemgrepProvider());
    registerProvider("snyk", createSnykProvider());

    const providers = getProviders();

    expect(providers.size).toBe(3);

    const codeql = getProvider("codeql");

    expect(codeql).toBeDefined();

    if (!codeql) {
      throw new Error("Provider should be defined");
    }

    const result = await codeql.analyze("");

    expect(result.evidence).toHaveLength(1);
    const firstEvidence = result.evidence.at(0);
    expect(firstEvidence?.source).toBe("CodeQL");
  });

  it("allows provider replacement via unregister and re-register", () => {
    const provider1 = createCodeQLProvider();
    registerProvider("codeql", provider1);

    expect(getProvider("codeql")).toBe(provider1);

    unregisterProvider("codeql");

    const provider2 = createCodeQLProvider();
    registerProvider("codeql", provider2);

    expect(getProvider("codeql")).toBe(provider2);
    expect(getProvider("codeql")).not.toBe(provider1);
  });
});

describe("Phase 11: AI Change Passport", () => {
  describe("deriveChangePassport", () => {
    it("creates a minimal passport with just required fields", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        {
          number: 42,
          title: "Add payment feature",
          author: "developer@example.com",
          repositoryName: "payments-api",
        },
      );

      expect(passport.id).toBe("passport-001");
      expect(passport.organizationId).toBe("org-001");
      expect(passport.prNumber).toBe(42);
      expect(passport.prTitle).toBe("Add payment feature");
      expect(passport.author).toBe("developer@example.com");
      expect(passport.repositoryName).toBe("payments-api");
      expect(passport.changedFiles).toHaveLength(0);
      expect(passport.sections).toBeDefined();
    });

    it("includes AI provenance in passport", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        {
          involvement: "YES",
          agent: "Claude Code",
          model: "Claude Sonnet",
          confidence: 0.94,
          source: "DEVELOPER_DECLARED",
        },
      );

      expect(passport.aiProvenance).toBeDefined();
      expect(passport.aiProvenance?.involvement).toBe("YES");
      expect(passport.aiProvenance?.agent).toBe("Claude Code");
      expect(passport.aiProvenance?.confidence).toBe(0.94);
      expect(passport.sections.some((s) => s.name === "AI Provenance")).toBe(true);
    });

    it("includes changed files and sensitive areas", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        [
          {
            filePath: "src/payments/refund.ts",
            sensitiveAreas: ["PAYMENTS", "AUTHORIZATION"],
            additions: 47,
            deletions: 12,
          },
          {
            filePath: "src/tests/refund.test.ts",
            sensitiveAreas: ["TESTING"],
            additions: 85,
            deletions: 0,
          },
        ],
      );

      expect(passport.changedFiles).toHaveLength(2);
      const firstFile = passport.changedFiles.at(0);
      expect(firstFile?.filePath).toBe("src/payments/refund.ts");
      expect(firstFile?.sensitiveAreas).toContain("PAYMENTS");
      expect(passport.sections.some((s) => s.name === "Sensitive Areas")).toBe(true);
    });

    it("includes risk assessment", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        {
          score: 72.5,
          level: "HIGH",
          modelVersion: "risk-v1",
          explanation: "High risk due to payment code + AI involvement",
        },
      );

      expect(passport.risk).toBeDefined();
      expect(passport.risk?.score).toBe(72.5);
      expect(passport.risk?.level).toBe("HIGH");
      expect(passport.sections.some((s) => s.name === "Risk Assessment")).toBe(true);
    });

    it("includes policy decision", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        undefined,
        {
          action: "REVIEW",
          matchedRuleIds: ["rule-payment-001"],
          requiredApprovals: ["security", "senior_engineer"],
          explanation: "Payment changes require security review",
        },
      );

      expect(passport.policy).toBeDefined();
      expect(passport.policy?.action).toBe("REVIEW");
      expect(passport.policy?.requiredApprovals).toContain("security");
      expect(passport.sections.some((s) => s.name === "Policy Evaluation")).toBe(true);
    });

    it("includes security findings summary", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        undefined,
        undefined,
        [
          { severity: "HIGH", category: "SAST", title: "SQL Injection" },
          { severity: "MEDIUM", category: "SCA", title: "Vulnerable Dependency" },
          { severity: "LOW", category: "SCA", title: "Outdated Package" },
        ],
      );

      expect(passport.findingsSummary).toBeDefined();
      expect(passport.findingsSummary?.total).toBe(3);
      expect(passport.findingsSummary?.bySeverity.HIGH).toBe(1);
      expect(passport.findingsSummary?.bySeverity.MEDIUM).toBe(1);
      expect(passport.findingsSummary?.bySeverity.LOW).toBe(1);
      expect(passport.findingsSummary?.byCategory.SAST).toBe(1);
      expect(passport.findingsSummary?.byCategory.SCA).toBe(2);
    });

    it("includes evidence summary", () => {
      const evidence = [
        { result: "PASS" as const, count: 5 },
        { result: "FAIL" as const, count: 1 },
        { result: "UNKNOWN" as const, count: 2 },
        { result: "NOT_RUN" as const, count: 0 },
        { result: "NOT_APPLICABLE" as const, count: 0 },
      ];

      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        evidence,
      );

      expect(passport.evidenceSummary).toEqual(evidence);
    });

    it("includes review decisions", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        {
          involvement: "YES",
          agent: "Claude",
          confidence: 0.95,
          source: "DEVELOPER_DECLARED",
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [
          {
            decision: "APPROVED",
            status: "COMPLETED",
            comment: "Looks good to me",
          },
          {
            decision: "CHANGES_REQUESTED",
            status: "PENDING",
            comment: "Need more tests",
          },
        ],
      );

      expect(passport.reviews).toHaveLength(2);
      const firstReview = passport.reviews.at(0);
      const secondReview = passport.reviews.at(1);
      expect(firstReview?.decision).toBe("APPROVED");
      expect(secondReview?.decision).toBe("CHANGES_REQUESTED");
      expect(passport.sections.length).toBeGreaterThan(0);
    });

    it("calculates overall status BLOCKED for blocked policy", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        undefined,
        {
          action: "BLOCK",
          matchedRuleIds: ["rule-secrets-001"],
          requiredApprovals: [],
          explanation: "Secrets detected",
        },
      );

      expect(passport.status).toBe("BLOCKED");
      expect(passport.overallFinding).toBe("FAIL");
    });

    it("calculates overall status REVIEW_REQUIRED for high risk", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        {
          score: 85,
          level: "CRITICAL",
          modelVersion: "risk-v1",
        },
      );

      expect(passport.status).toBe("REVIEW_REQUIRED");
      expect(passport.overallFinding).toBe("UNKNOWN");
    });

    it("calculates overall status APPROVED_WITH_CONDITIONS for review + approvals", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        undefined,
        {
          action: "REVIEW",
          matchedRuleIds: [],
          requiredApprovals: ["security"],
        },
        undefined,
        undefined,
        [
          {
            decision: "APPROVED",
            status: "COMPLETED",
          },
        ],
      );

      expect(passport.status).toBe("APPROVED_WITH_CONDITIONS");
    });

    it("builds sections array with all relevant checks", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        {
          involvement: "YES",
          agent: "Claude",
          confidence: 0.9,
          source: "DEVELOPER_DECLARED",
        },
        [{ filePath: "src/payments/main.ts", sensitiveAreas: ["PAYMENTS"], additions: 50, deletions: 10 }],
        { score: 70, level: "HIGH", modelVersion: "risk-v1" },
        { action: "REVIEW", matchedRuleIds: [], requiredApprovals: ["security"] },
      );

      expect(passport.sections.length).toBeGreaterThan(0);
      expect(passport.sections.some((s) => s.name === "AI Provenance")).toBe(true);
      expect(passport.sections.some((s) => s.name === "Sensitive Areas")).toBe(true);
      expect(passport.sections.some((s) => s.name === "Risk Assessment")).toBe(true);
      expect(passport.sections.some((s) => s.name === "Policy Evaluation")).toBe(true);
    });
  });

  describe("formatPassportForDisplay", () => {
    it("formats minimal passport for display", () => {
      const passport = deriveChangePassport("passport-001", "org-001", {
        number: 42,
        title: "Fix bug",
        author: "dev@example.com",
        repositoryName: "backend",
      });

      const formatted = formatPassportForDisplay(passport);

      expect(formatted).toContain("AI CHANGE PASSPORT");
      expect(formatted).toContain("PR #42");
      expect(formatted).toContain("backend");
      expect(formatted).toContain("Fix bug");
    });

    it("formats complete passport with all sections", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42, title: "Payment refund", author: "alice@example.com", repositoryName: "payments" },
        { involvement: "YES", agent: "Claude", confidence: 0.94, source: "DEVELOPER_DECLARED" },
        [{ filePath: "src/payments/refund.ts", sensitiveAreas: ["PAYMENTS"], additions: 100, deletions: 20 }],
        { score: 75, level: "HIGH", modelVersion: "risk-v1", explanation: "Payment code modification" },
        { action: "REVIEW", matchedRuleIds: ["rule-001"], requiredApprovals: ["security", "senior"] },
      );

      const formatted = formatPassportForDisplay(passport);

      expect(formatted).toContain("AI INVOLVEMENT");
      expect(formatted).toContain("Claude");
      expect(formatted).toContain("CHANGED FILES");
      expect(formatted).toContain("PAYMENTS");
      expect(formatted).toContain("RISK");
      expect(formatted).toContain("HIGH");
      expect(formatted).toContain("POLICY");
      expect(formatted).toContain("REVIEW");
    });

    it("includes status in formatted output", () => {
      const passport = deriveChangePassport("passport-001", "org-001", { number: 42 });
      passport.status = "APPROVED";

      const formatted = formatPassportForDisplay(passport);

      expect(formatted).toContain("STATUS");
      expect(formatted).toContain("APPROVED");
    });
  });

  describe("Passport Status Calculation", () => {
    it("prioritizes BLOCKED status", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        undefined,
        { action: "BLOCK", matchedRuleIds: [], requiredApprovals: [] },
      );

      expect(passport.status).toBe("BLOCKED");
    });

    it("handles CRITICAL risk as REVIEW_REQUIRED", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        { score: 90, level: "CRITICAL", modelVersion: "risk-v1" },
      );

      expect(passport.status).toBe("REVIEW_REQUIRED");
    });

    it("marks as APPROVED when all conditions met", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        { score: 20, level: "LOW", modelVersion: "risk-v1" },
        { action: "ALLOW", matchedRuleIds: [], requiredApprovals: [] },
      );

      expect(passport.status).toBe("APPROVED");
    });

    it("respects rejection in reviews", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        undefined,
        { action: "ALLOW", matchedRuleIds: [], requiredApprovals: [] },
        undefined,
        undefined,
        [{ decision: "REJECTED", status: "COMPLETED" }],
      );

      expect(passport.status).toBe("REJECTED");
    });
  });

  describe("Overall Finding Calculation", () => {
    it("returns FAIL for blocked policy", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        undefined,
        { action: "BLOCK", matchedRuleIds: [], requiredApprovals: [] },
      );

      expect(passport.overallFinding).toBe("FAIL");
    });

    it("returns UNKNOWN for critical risk", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        { score: 90, level: "CRITICAL", modelVersion: "risk-v1" },
        { action: "ALLOW", matchedRuleIds: [], requiredApprovals: [] },
      );

      expect(passport.overallFinding).toBe("UNKNOWN");
    });

    it("returns FAIL when evidence has failures", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        { score: 30, level: "LOW", modelVersion: "risk-v1" },
        { action: "ALLOW", matchedRuleIds: [], requiredApprovals: [] },
        undefined,
        [
          { result: "PASS", count: 3 },
          { result: "FAIL", count: 1 },
          { result: "UNKNOWN", count: 0 },
          { result: "NOT_RUN", count: 0 },
          { result: "NOT_APPLICABLE", count: 0 },
        ],
      );

      expect(passport.overallFinding).toBe("FAIL");
    });

    it("returns PASS when all evidence passes", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        { score: 20, level: "LOW", modelVersion: "risk-v1" },
        { action: "ALLOW", matchedRuleIds: [], requiredApprovals: [] },
        undefined,
        [
          { result: "PASS", count: 5 },
          { result: "FAIL", count: 0 },
          { result: "UNKNOWN", count: 0 },
          { result: "NOT_RUN", count: 0 },
          { result: "NOT_APPLICABLE", count: 0 },
        ],
      );

      expect(passport.overallFinding).toBe("PASS");
    });
  });

  describe("Explanation Building", () => {
    it("includes AI provenance info in explanation", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        { involvement: "YES", agent: "Claude Code", confidence: 0.94, source: "DEVELOPER_DECLARED" },
      );

      expect(passport.explanation).toContain("YES");
      expect(passport.explanation).toContain("Claude Code");
    });

    it("includes risk level in explanation", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        { score: 75, level: "HIGH", modelVersion: "risk-v1" },
      );

      expect(passport.explanation).toContain("HIGH");
    });

    it("includes policy action in explanation", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        undefined,
        { action: "REVIEW", matchedRuleIds: [], requiredApprovals: [] },
      );

      expect(passport.explanation).toContain("REVIEW");
    });

    it("includes final status in explanation", () => {
      const passport = deriveChangePassport(
        "passport-001",
        "org-001",
        { number: 42 },
        undefined,
        undefined,
        { score: 20, level: "LOW", modelVersion: "risk-v1" },
        { action: "ALLOW", matchedRuleIds: [], requiredApprovals: [] },
      );

      expect(passport.explanation).toContain("APPROVED");
    });
  });
});
