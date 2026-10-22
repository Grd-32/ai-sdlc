import type { Metadata } from "next";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "Terms for using the Nomalog software service.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="eyebrow">Nomalog service</p>
        <h1 className="page-title">Terms of service</h1>
        <p className="page-lede">
          These terms describe the current Nomalog service and the responsibilities that apply when
          you access or use it.
        </p>
        <div className="prose-copy mt-8 space-y-7">
          <section>
            <h2>Using the service</h2>
            <p>
              Nomalog provides software for viewing GitHub pull-request context, configured risk and
              policy decisions, reviews, and available security evidence. You may use the service
              only through an account you are authorized to access and in accordance with these
              terms.
            </p>
          </section>
          <section>
            <h2>Accounts and connected repositories</h2>
            <p>
              You must be authorized to connect repositories and submit their data for processing.
              You are responsible for choosing repositories, managing organization members, and
              reviewing permissions requested by GitHub and other integrations.
            </p>
          </section>
          <section>
            <h2>Results and service limitations</h2>
            <p>
              Results depend on integrations, configuration, incoming events, and available
              evidence. The service does not guarantee detection of every vulnerability or AI tool,
              and missing or NOT RUN evidence is not a clean result. Do not rely on the service as a
              substitute for independent security review.
            </p>
          </section>
          <section>
            <h2>Acceptable use and service changes</h2>
            <p>
              You may not use the service to violate law, access repositories without permission,
              interfere with service operation, or attempt to bypass access controls. Features and
              integrations may change as the service evolves.
            </p>
          </section>
          <section>
            <h2>Plans and additional terms</h2>
            <p>
              The free assessment is available through the public onboarding flow. Any paid plan,
              separate service commitment, or additional commercial term will be described to you
              before you choose to proceed with it.
            </p>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}
