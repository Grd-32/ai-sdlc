import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, ShieldCheck } from "lucide-react";
import { PublicHeader } from "@/components/public-header";
import { DOCS_GROUPS, PRODUCT_DOCS } from "@/lib/product-docs";

export function DocsFrame({
  activeSlug,
  children,
}: {
  activeSlug?: string;
  children: React.ReactNode;
}) {
  const activeIndex = PRODUCT_DOCS.findIndex((doc) => doc.slug === activeSlug);
  const previous = activeIndex > 0 ? PRODUCT_DOCS[activeIndex - 1] : undefined;
  const next = activeIndex >= 0 ? PRODUCT_DOCS[activeIndex + 1] : undefined;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <PublicHeader />
      <div className="mx-auto grid max-w-7xl lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 px-5 py-5 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
          <Link
            href="/docs"
            className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-900"
          >
            <BookOpen className="h-4 w-4 text-orange-700" />
            Documentation
          </Link>
          <nav aria-label="Documentation navigation" className="grid gap-5 sm:grid-cols-3 lg:block">
            {DOCS_GROUPS.map((group) => (
              <div key={group.label} className="mb-5">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {group.label}
                </p>
                <ul className="space-y-1">
                  {group.docs.map((doc) => {
                    const active = doc.slug === activeSlug;
                    return (
                      <li key={doc.slug}>
                        <Link
                          href={`/docs/${doc.slug}`}
                          aria-current={active ? "page" : undefined}
                          className={`block rounded-md px-3 py-2 text-sm transition ${
                            active
                              ? "bg-orange-50 font-semibold text-orange-800"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                          }`}
                        >
                          {doc.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="mt-6 hidden rounded-xl border border-slate-200 bg-slate-50 p-4 lg:block">
            <ShieldCheck className="h-5 w-5 text-orange-700" />
            <p className="mt-3 text-sm font-semibold text-slate-900">Ready to connect a repo?</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Start with a GitHub workspace and a test repository.
            </p>
            <Link
              href="/onboarding"
              prefetch={false}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-orange-800 hover:text-orange-900"
            >
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </aside>
        <main className="min-w-0 px-5 py-8 sm:px-10 lg:px-16 lg:py-12">
          <div className="mx-auto max-w-3xl">{children}</div>
          {activeSlug && (
            <div className="mx-auto mt-14 flex max-w-3xl justify-between gap-4 border-t border-slate-200 pt-5">
              {previous ? (
                <Link
                  href={`/docs/${previous.slug}`}
                  className="group max-w-[48%] text-sm text-slate-600 hover:text-slate-950"
                >
                  <span className="mb-1 flex items-center gap-1 text-xs text-slate-400">
                    <ArrowLeft className="h-3.5 w-3.5" /> Previous
                  </span>
                  <span className="font-semibold">{previous.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  href={`/docs/${next.slug}`}
                  className="group max-w-[48%] text-right text-sm text-slate-600 hover:text-slate-950"
                >
                  <span className="mb-1 flex items-center justify-end gap-1 text-xs text-slate-400">
                    Next <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-semibold">{next.title}</span>
                </Link>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
