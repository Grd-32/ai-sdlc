import { beforeEach, describe, expect, it, vi } from "vitest";

type ProvenanceSignalWrite = {
  where: {
    organizationId_signalKey: { organizationId: string; signalKey: string };
  };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  activityFindFirst: vi.fn(),
  activityCreate: vi.fn(),
  activityUpdate: vi.fn(),
  provenanceSignalUpsert: vi.fn<(args: ProvenanceSignalWrite) => Promise<{ id: string }>>(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    aIActivity: {
      findFirst: mocks.activityFindFirst,
      create: mocks.activityCreate,
      update: mocks.activityUpdate,
    },
    provenanceSignal: { upsert: mocks.provenanceSignalUpsert },
  },
  recordAuditEvent: vi.fn(),
}));

vi.mock("@ai-sdlc/billing", () => ({
  resolveOrganizationEntitlements: vi.fn(),
}));

vi.mock("./queue.js", () => ({
  enqueueGitHubWebhookEvent: vi.fn(),
  enqueuePullRequestAnalysis: vi.fn(),
  getGitHubWebhookEventJobId: vi.fn(),
}));

const { persistAIActivityForPullRequest } = await import("./webhooks.js");

describe("first-class GitHub provenance signals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activityFindFirst.mockResolvedValue(null);
    mocks.activityCreate.mockResolvedValue({ id: "activity-1" });
    mocks.activityUpdate.mockResolvedValue({ id: "activity-1" });
    mocks.provenanceSignalUpsert.mockResolvedValue({ id: "signal-1" });
  });

  function lastSignalWrite(): ProvenanceSignalWrite {
    const args = mocks.provenanceSignalUpsert.mock.calls[0]?.[0];
    if (!args) throw new Error("Expected a provenance signal upsert.");
    return args;
  }

  it("records a declaration as unverified rather than observed proof", async () => {
    await persistAIActivityForPullRequest("org-1", "repo-1", "pr-1", {
      pull_request: {
        id: 9001,
        title: "AI-assisted implementation with GitHub Copilot",
        body: "Declared by the contributor.",
        head: { sha: "head-1" },
      },
    });

    const write = lastSignalWrite();
    expect(write.where).toEqual({
      organizationId_signalKey: {
        organizationId: "org-1",
        signalKey: "github:pull-request:pr-1:current",
      },
    });
    expect(write.create).toMatchObject({
      provider: "GITHUB",
      classification: "DECLARED",
      verificationStatus: "UNVERIFIED",
      signalType: "DECLARED_PULL_REQUEST_TEXT",
      evidenceReference: "github:pull-request:9001",
      headSha: "head-1",
    });
    expect(write.create["limitations"]).toBe(
      "AI involvement is self-declared in pull-request metadata and has not been independently verified.",
    );
  });

  it("records a recognized provider bot as observed without claiming full authorship", async () => {
    await persistAIActivityForPullRequest("org-1", "repo-1", "pr-2", {
      pull_request: {
        id: 9002,
        title: "Refactor authentication",
        user: { login: "copilot[bot]", type: "Bot" },
      },
    });

    const write = lastSignalWrite();
    expect(write.create).toMatchObject({
      classification: "OBSERVED",
      verificationStatus: "VERIFIED",
      signalType: "KNOWN_AI_BOT_AUTHOR",
    });
    expect(write.create["limitations"]).toBe(
      "The provider identifies an AI coding-agent bot account; this does not prove that all change content was AI-authored.",
    );
  });

  it("persists unknown provenance instead of treating absent signals as negative proof", async () => {
    await persistAIActivityForPullRequest("org-1", "repo-1", "pr-3", {
      pull_request: { id: 9003, title: "Update dependency" },
    });

    const write = lastSignalWrite();
    expect(write.create).toMatchObject({
      classification: "UNKNOWN",
      verificationStatus: "NOT_APPLICABLE",
      signalType: "NO_MATCHING_PROVENANCE_SIGNAL",
      confidence: 0,
    });
    expect(write.create["limitations"]).toBe(
      "Available provider metadata cannot confirm or rule out AI involvement.",
    );
  });
});
