import type { Metadata } from "next";
import { Suspense } from "react";
import { ContactForm } from "@/components/contact-form";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Contact Nomalog",
  description: "Send a product, Professional offer, or Enterprise enquiry to Nomalog.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <PublicShell>
      <main className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="eyebrow">Contact</p>
          <h1 className="page-title">Tell us what you need to govern.</h1>
          <p className="page-lede">
            Ask about product fit, assessment setup, or a potential Professional or Enterprise
            engagement.
          </p>
          <p className="mt-6 text-sm leading-6 text-slate-600">
            Share a little about your team and what you are evaluating. Please do not include
            credentials, source code, or other sensitive information.
          </p>
        </div>
        <Suspense
          fallback={
            <div className="surface-card p-8 text-sm text-slate-600">Loading enquiry form…</div>
          }
        >
          <ContactForm />
        </Suspense>
      </main>
    </PublicShell>
  );
}
