import { describe, expect, it, vi } from "vitest";
import { createAzureFoundryCodeReviewProvider } from "./index.js";

const reviewFile = {
  path: "src/auth.ts",
  patch: "@@ -1 +1 @@\n-const query = input;\n+db.query(input);",
};

const enabledOptions = {
  enabled: true,
  endpoint: "https://example.openai.azure.com/openai/v1/",
  apiKey: "test-api-key",
  model: "security-review-deployment",
  files: [reviewFile],
};

describe("Azure AI Foundry code review provider", () => {
  it("does not send source when the feature is disabled", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createAzureFoundryCodeReviewProvider({
      ...enabledOptions,
      enabled: false,
      fetcher,
    });

    const result = await provider.analyze("pr-id");

    expect(result.evidence[0]).toMatchObject({
      type: "SECURITY_REVIEW",
      result: "NOT_RUN",
      metadata: { reason: "AI code review is disabled by configuration." },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not send source when provider credentials are incomplete", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createAzureFoundryCodeReviewProvider({
      ...enabledOptions,
      apiKey: undefined,
      fetcher,
    });

    const result = await provider.analyze("pr-id");

    expect(result.evidence[0]).toMatchObject({
      result: "NOT_RUN",
      metadata: {
        reason:
          "Set AZURE_OPENAI_BASE_URL, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_MODEL to enable AI code review.",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not review a partial diff when a changed file has no patch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createAzureFoundryCodeReviewProvider({
      ...enabledOptions,
      files: [reviewFile, { path: "src/large-file.ts" }],
      fetcher,
    });

    const result = await provider.analyze("pr-id");

    expect(result.evidence[0]?.result).toBe("NOT_RUN");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends bounded diff context to Azure and marks reported findings for human verification", async () => {
    let capturedBody = "";
    let capturedApiKey: string | undefined;
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      capturedApiKey = new Headers(init?.headers).get("api-key") ?? undefined;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    findings: [
                      {
                        severity: "HIGH",
                        title: "SQL query uses untrusted input",
                        description: "The value reaches a query without parameterization.",
                        file: "src/auth.ts",
                        line: 2,
                        ruleId: "sql-injection",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });

    const result = await createAzureFoundryCodeReviewProvider({
      ...enabledOptions,
      fetcher,
    }).analyze("pr-id");

    expect(capturedApiKey).toBe("test-api-key");
    expect(capturedBody).toContain('"model":"security-review-deployment"');
    expect(capturedBody).toContain("const query = input");
    expect(capturedBody).toContain("db.query(input)");
    expect(result.findings).toMatchObject([
      {
        provider: "Azure AI Foundry",
        category: "AI_SECURITY",
        severity: "HIGH",
        file: "src/auth.ts",
        line: 2,
        status: "NEEDS_HUMAN_REVIEW",
        metadata: { requiresHumanVerification: true },
      },
    ]);
    expect(result.evidence[0]?.result).toBe("FAIL");
  });

  it("rejects malformed findings instead of treating them as a clean review", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ findings: [{ file: "other.ts" }] }) } }],
        }),
        { status: 200 },
      ),
    );

    await expect(
      createAzureFoundryCodeReviewProvider({ ...enabledOptions, fetcher }).analyze("pr-id"),
    ).rejects.toThrow("references a file outside the reviewed diff");
  });

  it("returns PASS only after a valid completed response with an empty findings list", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ findings: [] }) } }],
        }),
        { status: 200 },
      ),
    );

    const result = await createAzureFoundryCodeReviewProvider({
      ...enabledOptions,
      fetcher,
    }).analyze("pr-id");

    expect(result.evidence[0]).toMatchObject({
      type: "SECURITY_REVIEW",
      source: "Azure AI Foundry",
      result: "PASS",
      metadata: { requiresHumanVerification: true, findings: 0 },
    });
  });
});
