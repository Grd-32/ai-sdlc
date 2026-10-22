"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

export type ProductAnalyticsEvent =
  | "landing_page_visit"
  | "assessment_cta_clicked"
  | "signup_started"
  | "signup_completed"
  | "organization_created"
  | "repository_integration_started"
  | "repository_integration_completed"
  | "assessment_started"
  | "assessment_completed"
  | "report_viewed"
  | "pricing_viewed"
  | "checkout_started"
  | "subscription_activated"
  | "subscription_cancelled";

interface ProductEventLinkProps {
  href: string;
  event: ProductAnalyticsEvent;
  className?: string;
  children: ReactNode;
}

const CONSENT_KEY = "nomalog-analytics-consent";
const MEASUREMENT_ID = process.env["NEXT_PUBLIC_GA_MEASUREMENT_ID"];

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function hasConsent(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

export function trackProductEvent(event: ProductAnalyticsEvent): void {
  if (!MEASUREMENT_ID || !hasConsent()) return;
  window.gtag?.("event", event);
}

export function ProductEventLink({ href, event, className, children }: ProductEventLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        trackProductEvent(event);
      }}
    >
      {children}
    </Link>
  );
}

function pageCategory(pathname: string): "landing" | "pricing" | "assessment" | "product" | "app" {
  if (pathname === "/") return "landing";
  if (pathname === "/pricing") return "pricing";
  if (pathname === "/assessment") return "assessment";
  if (["/product", "/how-it-works", "/security", "/docs"].includes(pathname)) return "product";
  return "app";
}

export function ProductAnalytics() {
  const pathname = usePathname();
  const [consent, setConsent] = useState<"unknown" | "accepted" | "rejected">("unknown");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!MEASUREMENT_ID) return;
    try {
      const saved = window.localStorage.getItem(CONSENT_KEY);
      if (saved === "accepted" || saved === "rejected") setConsent(saved);
    } catch {
      setConsent("rejected");
    }
  }, []);

  useEffect(() => {
    if (!MEASUREMENT_ID || consent !== "accepted" || loaded) return;
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = (...args: unknown[]) => {
      window.dataLayer?.push(args);
    };
    window.gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted",
    });
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      send_page_view: false,
      page_location: `${window.location.origin}/app`,
      page_referrer: window.location.origin,
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
    script.onload = () => {
      setLoaded(true);
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [consent, loaded]);

  useEffect(() => {
    if (!pathname || !loaded) return;
    const category = pageCategory(pathname);
    if (category === "landing") trackProductEvent("landing_page_visit");
    if (category === "pricing") trackProductEvent("pricing_viewed");
    window.gtag?.("event", "page_view", {
      page_path: `/${category}`,
      page_location: `${window.location.origin}/${category}`,
      page_referrer: window.location.origin,
    });

    const url = new URL(window.location.href);
    if (url.searchParams.get("signup") === "completed") {
      trackProductEvent("signup_completed");
      url.searchParams.delete("signup");
      window.history.replaceState({}, "", url);
    }
    if (url.searchParams.get("organization") === "created") {
      trackProductEvent("organization_created");
      url.searchParams.delete("organization");
      window.history.replaceState({}, "", url);
    }
    if (url.searchParams.has("installed")) {
      trackProductEvent("repository_integration_completed");
      url.searchParams.delete("installed");
      window.history.replaceState({}, "", url);
    }
  }, [pathname, loaded]);

  if (!MEASUREMENT_ID || consent !== "unknown") return null;
  return (
    <aside
      aria-label="Analytics preference"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-800 shadow-xl"
    >
      <p>
        Allow optional product analytics? Nomalog records only approved event names and coarse page
        categories—not repository, account, or security data. See the{" "}
        <a className="underline" href="/privacy">
          privacy notice
        </a>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            saveConsent("accepted", setConsent);
          }}
        >
          Allow analytics
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            saveConsent("rejected", setConsent);
          }}
        >
          Reject
        </button>
      </div>
    </aside>
  );
}

export function AnalyticsPreferences() {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="text-sm font-medium text-orange-800 underline"
        onClick={() => {
          try {
            window.localStorage.removeItem(CONSENT_KEY);
            window.location.reload();
          } catch {
            setError("Your browser did not allow the analytics preference to be reset.");
          }
        }}
      >
        Review analytics preference
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function saveConsent(
  value: "accepted" | "rejected",
  update: (value: "accepted" | "rejected") => void,
): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
    update(value);
  } catch {
    update("rejected");
  }
}

declare global {
  interface Window {
    dataLayer?: unknown[][];
  }
}
