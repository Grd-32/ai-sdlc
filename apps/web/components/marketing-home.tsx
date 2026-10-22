import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  Bot,
  Braces,
  CircleHelp,
  FileCheck2,
  GitPullRequest,
  KeyRound,
  SearchCheck,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { ProductEventLink } from "@/components/product-analytics";

const challenges = [
  [
    "Security findings arrive out of context",
    "Findings, changes, and review decisions are spread across tools.",
  ],
  [
    "Review practices vary by team",
    "Policies and approvals can be difficult to apply consistently.",
  ],
  [
    "AI involvement is hard to establish",
    "Available signals can help, but absence of a signal is not proof of no AI use.",
  ],
  [
    "Dependency and secret risks persist",
    "The checks you configure need to be visible alongside the change they assess.",
  ],
  [
    "Evidence gets fragmented",
    "Teams need to understand which results were run, skipped, or are still unknown.",
  ],
  ["Decisions lack a clear trail", "Risk and policy outcomes should be reviewable, not opaque."],
];

const capabilities = [
  {
    icon: Bot,
    title: "AI provenance signals",
    text: "Capture explicit declarations and recognized signals while preserving unknown attribution as unknown.",
  },
  {
    icon: Braces,
    title: "Change risk context",
    text: "Use deterministic risk signals and changed-file context to explain why a change may need attention.",
  },
  {
    icon: Workflow,
    title: "Policy decisions",
    text: "Evaluate configured policies and show ALLOW, REVIEW, or BLOCK decisions with their rationale.",
  },
  {
    icon: FileCheck2,
    title: "Human review workflow",
    text: "Assign eligible reviewers and record per-commit decisions where policy requires human review.",
  },
  {
    icon: SearchCheck,
    title: "Evidence visibility",
    text: "View persisted evidence status and GitHub Code Scanning results when configured and available.",
  },
  {
    icon: GitPullRequest,
    title: "Change Passports",
    text: "Inspect available provenance, risk, policy decisions, reviews, and evidence for a pull request.",
  },
];

const steps = [
  "Connect a GitHub organization and select repositories.",
  "Open or update a pull request so the integration can process the change.",
  "Review available change, risk, AI attribution, and configured security evidence.",
  "Evaluate policy and route REVIEW outcomes to eligible human reviewers.",
  "Inspect the change's recorded decisions and evidence in its Change Passport.",
  "Use the workspace to monitor connected repositories and incoming changes.",
];

export function MarketingHome() {
  return (
    <PublicShell>
      <main>
        <section className="site-hero relative overflow-hidden border-b border-slate-200">
          <div className="mx-auto grid max-w-7xl gap-14 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:py-28">
            <div>
              <p className="eyebrow">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-600" />
                Engineering governance · GitHub pull requests
              </p>
              <h1 className="mt-7 max-w-3xl text-5xl font-semibold leading-[1.06] tracking-[-0.045em] text-slate-950 sm:text-6xl lg:text-[4.35rem]">
                Know the security risks in your AI-assisted code.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                Assess repository security and governance signals, then trace available findings,
                risk decisions, policies, approvals, and evidence through each code change.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ProductEventLink
                  href="/assessment"
                  event="assessment_cta_clicked"
                  className="button-primary"
                >
                  Start free assessment <ArrowRight className="h-4 w-4" />
                </ProductEventLink>
                <Link href="/product" className="button-secondary">
                  Explore the platform
                </Link>
              </div>
              <p className="mt-5 text-xs leading-5 text-slate-500">
                Starts with GitHub sign-in and a repository you choose. Available analysis depends
                on configured integrations and incoming pull requests.
              </p>
            </div>

            <div className="passport-card">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">
                    Change Passport · example
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">PR #284 · service</p>
                </div>
                <span className="rounded border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs font-medium text-amber-200">
                  Review
                </span>
              </div>
              <div className="space-y-3 p-5">
                <div className="grid grid-cols-2 gap-3">
                  <PassportSignal label="AI involvement" value="Signal recorded" />
                  <PassportSignal label="Risk" value="Evaluated" />
                  <PassportSignal label="Policy" value="Review required" />
                  <PassportSignal label="Evidence" value="Current status" />
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900/80 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <ShieldCheck className="h-4 w-4 text-orange-300" />
                    Decision context
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Configured policy can request human review when change signals meet its rules.
                  </p>
                  <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-400">
                    Illustrative preview · availability follows configured policy and evidence
                  </p>
                </div>
              </div>
            </div>
          </div>
          <Link
            href="#workflow"
            className="absolute bottom-5 right-8 hidden items-center gap-2 text-xs font-medium text-slate-500 lg:flex"
          >
            Explore the workflow <ArrowDownRight className="h-4 w-4" />
          </Link>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
          <SectionIntro
            kicker="Why Nomalog"
            title="AI changes the pace. It should not erase the review trail."
            text="Security and engineering teams need a shared view of what changed, which signals are available, what policy decided, and where evidence is missing."
          />
          <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {challenges.map(([title, text], index) => (
              <article key={title} className="surface-card min-h-36 p-5">
                <p className="font-mono text-xs text-orange-700">0{index + 1}</p>
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="site-band border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionIntro
                kicker="How it works"
                title="One traceable path from repository to decision."
                text="Nomalog works from connected GitHub repositories and pull-request events. Start small; review the evidence before enabling enforcement."
              />
              <Link
                href="/how-it-works"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-orange-800"
              >
                See the workflow <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <ol className="grid gap-3 sm:grid-cols-2">
              {steps.map((step, index) => (
                <li key={step} className="rounded-md border border-slate-200 bg-[#fbfaf8] p-5">
                  <span className="font-mono text-xs text-orange-700">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
          <SectionIntro
            kicker="Platform"
            title="Useful signals, with their limits made visible."
            text="These capabilities are present in the application. Their results depend on integration setup, available GitHub events, configured policies, and evidence providers."
          />
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map(({ icon: Icon, title, text }) => (
              <article key={title} className="surface-card p-5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-orange-50 text-orange-800">
                  <Icon className="h-4 w-4" />
                </span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Not a standalone whole-repository scanner. Nomalog connects to GitHub change workflows
            and displays configured provider evidence; a missing or NOT RUN result is not a pass.
          </p>
        </section>

        <section className="site-band border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-8 md:grid-cols-2 md:items-center">
            <div>
              <SectionIntro
                kicker="Free AI Risk Assessment"
                title="Start with one repository and see what your workflow can tell you."
                text="Create a workspace, connect GitHub, and inspect an actual pull request. This is an integration-led assessment of change and governance signals—not an automatic source-code audit."
              />
              <Link
                href="/assessment"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-orange-800"
              >
                Assessment scope and permissions <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="surface-card p-6">
              <h3 className="font-semibold">A practical first assessment</h3>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <li className="flex gap-2">
                  <span className="text-orange-700">01</span> Sign in with GitHub and create a
                  workspace.
                </li>
                <li className="flex gap-2">
                  <span className="text-orange-700">02</span> Install the GitHub App and choose
                  repository access.
                </li>
                <li className="flex gap-2">
                  <span className="text-orange-700">03</span> Open/update a test pull request and
                  review available signals.
                </li>
              </ul>
              <Link href="/assessment" className="button-primary mt-6 w-full">
                Assess my repositories <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <SectionIntro
                kicker="Security & privacy"
                title="Clear boundaries. No unsupported guarantees."
                text="GitHub installation permissions and workspace membership govern access. Repository access is selected during installation; configured webhooks are signature-verified."
              />
              <Link
                href="/security"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-orange-800"
              >
                Read security and data handling <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="surface-card p-6">
              <div className="flex gap-3">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-orange-700" />
                <div>
                  <h3 className="font-semibold">A measured approach to claims</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Nomalog does not claim certification, complete AI-tool detection, or that an
                    unreported finding means code is safe. Read the current data lifecycle and
                    integration guides before connecting production repositories.
                  </p>
                  <Link
                    href="/docs/data-lifecycle"
                    className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange-800"
                  >
                    Data lifecycle guide <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="site-band border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-8 md:grid-cols-[1fr_1fr] md:items-center">
            <div>
              <SectionIntro
                kicker="Pricing"
                title="Start with the assessment. Discuss fit before a commitment."
                text="There is no self-serve checkout or published subscription price configured in this application today."
              />
              <Link
                href="/pricing"
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-orange-800"
              >
                View offer details <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="surface-card p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-orange-800">
                  Start here
                </p>
                <h3 className="mt-2 font-semibold">Free assessment</h3>
                <p className="mt-2 text-sm text-slate-600">
                  No-cost workspace setup and guided first evaluation.
                </p>
              </div>
              <div className="surface-card p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  For teams
                </p>
                <h3 className="mt-2 font-semibold">Professional &amp; Enterprise</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Contact us to discuss availability and commercial terms.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
          <SectionIntro kicker="FAQ" title="Good questions before connecting a repository." />
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <Faq question="Does Nomalog scan every file in a repository?">
              No. The current assessment follows GitHub change and pull-request workflows. Security
              evidence depends on configured providers such as GitHub Code Scanning.
            </Faq>
            <Faq question="Can Nomalog detect every AI coding tool?">
              No. It records available explicit declarations and recognized signals. Detection is
              incomplete; UNKNOWN does not mean no AI involvement.
            </Faq>
            <Faq question="Do I have to enforce policies immediately?">
              No. Begin with a test repository and review the outcomes. Validate policy behavior and
              branch protection before enabling enforcement for production repositories.
            </Faq>
            <Faq question="What happens if a security provider is not configured?">
              Its evidence may remain NOT RUN or unavailable. Nomalog does not treat missing
              evidence as a passing check.
            </Faq>
          </div>
          <div className="mt-8 rounded-md border border-orange-200 bg-orange-50/70 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div className="flex gap-3">
              <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-orange-800" />
              <div>
                <h3 className="font-semibold">Start with an honest baseline.</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Connect a test repository and inspect what is known, missing, and still needs
                  configuration.
                </p>
              </div>
            </div>
            <Link href="/assessment" className="button-primary mt-4 shrink-0 sm:mt-0">
              Start free assessment <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}

function SectionIntro({ kicker, title, text }: { kicker: string; title: string; text?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{kicker}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-base leading-7 text-slate-600">{text}</p>}
    </div>
  );
}

function PassportSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-100">{value}</p>
    </div>
  );
}

function Faq({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <details className="surface-card group p-5">
      <summary className="cursor-pointer list-none font-semibold marker:hidden">
        {question}
        <span className="float-right text-orange-700 transition group-open:rotate-45">+</span>
      </summary>
      <p className="mt-3 max-w-prose text-sm leading-6 text-slate-600">{children}</p>
    </details>
  );
}
