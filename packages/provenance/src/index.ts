/**
 * AI provenance and attribution package.
 * Phase 5+: AI involvement detection, confidence, provenance sources.
 */

export type ProvenanceSource =
  | "DEVELOPER_DECLARED"
  | "AGENT_TELEMETRY"
  | "GIT_METADATA"
  | "IDE_SIGNAL"
  | "BEHAVIORAL_INFERENCE"
  | "CI_SIGNAL"
  | "UNKNOWN";

export type AIInvolvement = "YES" | "NO" | "UNKNOWN";

export interface ProvenanceEvidence {
  reason: string;
  detail?: string;
}

export interface ProvenanceResult {
  /** YES / NO / UNKNOWN — never present inferred attribution as absolute truth */
  involvement: AIInvolvement;
  agentName?: string;
  modelName?: string;
  confidence: number;
  source: ProvenanceSource;
  evidence: ProvenanceEvidence[];
}

export interface GitHubPullRequestProvenancePayload {
  title?: string;
  body?: string | null;
  user?: { login?: string | null; type?: string | null } | null;
  head?: { ref?: string | null; sha?: string | null } | null;
  commitMessages?: string[];
}

const AGENT_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  { regex: /\bclaude[- ]?code\b/i, name: "Claude Code" },
  { regex: /\bgithub copilot\b|\bcopilot\b/i, name: "GitHub Copilot" },
  { regex: /\bcodex\b/i, name: "Codex" },
  { regex: /\bgpt-?\d+\b|\bchatgpt\b/i, name: "ChatGPT" },
  { regex: /\bcursor\b/i, name: "Cursor" },
  { regex: /\bdevin\b/i, name: "Devin" },
];

const DECLARATION_PATTERNS: Array<RegExp> = [
  /\bai[- ]assisted\b/i,
  /\bai[- ]generated\b/i,
  /\bdeveloper[- ]declared\s+ai(?:[- ]assisted)?\b/i,
  /\b(?:generated|written|authored|created)\s+(?:by|with|using)\s+(?:an?\s+)?(?:ai|claude(?:\s+code)?|copilot|codex|chatgpt|gpt[- ]?\d+|cursor|devin)\b/i,
  /\b(?:created|written|generated)\s+with\s+(?:the\s+)?help\s+of\s+(?:an?\s+)?ai\b/i,
  /\bco-authored-by:\s*(?:github copilot|claude(?:\s+code)?|codex|chatgpt|cursor|devin)\b/i,
];

const AI_BOT_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  {
    regex: /\bcopilot(?:-swe-agent|-pull-request-reviewer)?(?:\[bot\])?$/i,
    name: "GitHub Copilot",
  },
  { regex: /\bclaude(?:-code)?(?:\[bot\])?$/i, name: "Claude Code" },
  { regex: /\bcodex(?:\[bot\])?$/i, name: "Codex" },
  { regex: /\bdevin(?:\[bot\])?$/i, name: "Devin" },
  { regex: /\bcursor(?:\[bot\])?$/i, name: "Cursor" },
];

const COMMIT_PROVENANCE_TRAILER =
  /^(?:AI-Assisted-By|Co-authored-by):\s*(?:GitHub\s+)?(Copilot|Claude(?:\s+Code)?|Codex|ChatGPT|GPT-?\d+|Cursor|Devin)(?:\s*<[^>\r\n]+>)?\s*$/im;

function normalizeText(value?: string | null): string {
  return (value ?? "").trim();
}

export function inferAIProvenanceFromPullRequest(
  payload: GitHubPullRequestProvenancePayload,
): ProvenanceResult {
  const title = normalizeText(payload.title);
  const body = normalizeText(payload.body);
  const candidateText = [title, body].filter(Boolean).join(" ");

  const authorLogin = normalizeText(payload.user?.login);
  if (payload.user?.type?.toLowerCase() === "bot") {
    const botMatch = AI_BOT_PATTERNS.find((pattern) => pattern.regex.test(authorLogin));
    if (botMatch) {
      return {
        involvement: "YES",
        agentName: botMatch.name,
        confidence: 0.99,
        source: "GIT_METADATA",
        evidence: [
          {
            reason: "GitHub identifies the pull request author as a known AI coding agent bot",
            detail: `GitHub bot account: ${authorLogin}`,
          },
        ],
      };
    }
  }

  for (const commitMessage of payload.commitMessages ?? []) {
    const trailer = COMMIT_PROVENANCE_TRAILER.exec(commitMessage);
    if (!trailer) {
      continue;
    }

    const agentName =
      AGENT_PATTERNS.find((pattern) => pattern.regex.test(trailer[1] ?? ""))?.name ?? "Unknown";
    return {
      involvement: "YES",
      agentName,
      confidence: 0.98,
      source: "GIT_METADATA",
      evidence: [
        {
          reason: "Commit message contains an explicit AI provenance trailer",
          detail: `Git commit trailer declares assistance from ${agentName}.`,
        },
      ],
    };
  }

  if (!candidateText) {
    return {
      involvement: "UNKNOWN",
      confidence: 0,
      source: "UNKNOWN",
      evidence: [
        {
          reason: "No provenance signal available",
          detail: "The pull request has no title or description to evaluate.",
        },
      ],
    };
  }

  const agentMatch = AGENT_PATTERNS.find((pattern) => pattern.regex.test(candidateText));
  const sourceMatch = DECLARATION_PATTERNS.some((pattern) => pattern.test(candidateText));

  if (sourceMatch) {
    const agentName = agentMatch?.name ?? "Unknown";
    return {
      involvement: "YES",
      agentName,
      confidence: agentMatch ? 0.94 : 0.75,
      source: "DEVELOPER_DECLARED",
      evidence: [
        {
          reason: "Developer declaration detected",
          detail: agentMatch
            ? `PR text declares AI assistance and names ${agentName}.`
            : "PR text contains an explicit AI-assistance declaration.",
        },
      ],
    };
  }

  return {
    involvement: "UNKNOWN",
    confidence: 0,
    source: "UNKNOWN",
    evidence: [
      {
        reason: "No provenance signals matched",
        detail: "AI use cannot be confirmed or ruled out from the available GitHub metadata.",
      },
    ],
  };
}

export const PROVENANCE_PACKAGE_VERSION = "0.1.0";
