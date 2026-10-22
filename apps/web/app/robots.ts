import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/lib/public-site";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const origin = getSiteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/onboarding"],
    },
    sitemap: new URL("/sitemap.xml", origin).toString(),
  };
}
