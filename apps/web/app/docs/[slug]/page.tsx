import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Info, TriangleAlert } from "lucide-react";
import { DocsFrame } from "@/components/docs-frame";
import { PRODUCT_DOCS, getProductDoc } from "@/lib/product-docs";

export function generateStaticParams() {
  return PRODUCT_DOCS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = getProductDoc(slug);
  return doc
    ? {
        title: doc.title,
        description: doc.summary,
        alternates: { canonical: `/docs/${doc.slug}` },
      }
    : {};
}

export default async function ProductDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getProductDoc(slug);
  if (!doc) notFound();

  return (
    <DocsFrame activeSlug={doc.slug}>
      <article>
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">
          <Link href="/docs" className="hover:underline">
            Docs
          </Link>
          <span aria-hidden="true">/</span>
          <span>{doc.group}</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          {doc.title}
        </h1>
        <p className="mt-4 border-b border-slate-200 pb-8 text-lg leading-8 text-slate-600">
          {doc.summary}
        </p>

        <div className="space-y-8 py-8">
          {doc.sections.map((section, index) => {
            if (section.type === "paragraph") {
              return (
                <p key={index} className="text-[15px] leading-7 text-slate-700">
                  {section.text}
                </p>
              );
            }
            if (section.type === "steps") {
              return (
                <ol key={index} className="space-y-5">
                  {section.items.map((item, stepIndex) => (
                    <li key={item.title} className="flex gap-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-orange-200 bg-orange-50 text-xs font-bold text-orange-800">
                        {stepIndex + 1}
                      </span>
                      <div>
                        <h2 className="font-semibold text-slate-950">{item.title}</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{item.body}</p>
                        {item.href && item.linkText && (
                          <Link
                            href={item.href}
                            prefetch={false}
                            className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-orange-800 hover:text-orange-950"
                          >
                            {item.linkText} <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              );
            }
            if (section.type === "code") {
              return (
                <figure key={index} className="overflow-hidden rounded-lg border border-slate-800">
                  <figcaption className="border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-300">
                    {section.label}
                  </figcaption>
                  <pre className="overflow-x-auto bg-slate-950 p-4 text-sm leading-6 text-orange-100">
                    <code>{section.code}</code>
                  </pre>
                </figure>
              );
            }
            const warning = section.tone === "warning";
            const Icon = warning ? TriangleAlert : Info;
            return (
              <aside
                key={index}
                className={`rounded-lg border p-4 ${
                  warning ? "border-amber-200 bg-amber-50" : "border-sky-200 bg-sky-50"
                }`}
              >
                <h2
                  className={`flex items-center gap-2 text-sm font-semibold ${
                    warning ? "text-amber-950" : "text-sky-950"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {section.title}
                </h2>
                <p
                  className={`mt-1 text-sm leading-6 ${
                    warning ? "text-amber-900" : "text-sky-900"
                  }`}
                >
                  {section.text}
                </p>
              </aside>
            );
          })}
        </div>
      </article>
    </DocsFrame>
  );
}
