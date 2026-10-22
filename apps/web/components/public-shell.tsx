import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { PublicHeader } from "@/components/public-header";
import { ThemeToggle } from "@/components/theme-toggle";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell min-h-screen bg-[#fbfaf8] text-slate-950">
      <PublicHeader />
      {children}
      <footer className="site-footer border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 md:grid-cols-[1.4fr_2fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-5 w-5 text-orange-700" />
              Nomalog
            </Link>
            <p className="mt-3 max-w-sm text-sm leading-6 text-slate-600">
              Security and governance context for AI-assisted software changes.
            </p>
            <div className="mt-4">
              <ThemeToggle />
            </div>
          </div>
          <nav
            aria-label="Footer navigation"
            className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3"
          >
            <Link href="/product" className="footer-link">
              Platform
            </Link>
            <Link href="/how-it-works" className="footer-link">
              How it works
            </Link>
            <Link href="/assessment" className="footer-link">
              Free assessment
            </Link>
            <Link href="/pricing" className="footer-link">
              Pricing
            </Link>
            <Link href="/security" className="footer-link">
              Security &amp; privacy
            </Link>
            <Link href="/docs/quickstart" className="footer-link">
              Getting started
            </Link>
            <Link href="/contact" className="footer-link">
              Contact
            </Link>
            <Link href="/terms" className="footer-link">
              Terms
            </Link>
            <Link href="/privacy" className="footer-link">
              Privacy
            </Link>
          </nav>
        </div>
        <div className="border-t border-slate-200">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <span>© {new Date().getFullYear()} Nomalog</span>
            <Link
              href="/assessment"
              className="inline-flex items-center gap-1 font-medium text-orange-800"
            >
              Start with the free assessment <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
