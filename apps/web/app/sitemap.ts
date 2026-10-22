import type { MetadataRoute } from "next";
import { PRODUCT_DOCS } from "@/lib/product-docs";
import { getSiteOrigin } from "@/lib/public-site";

export const dynamic = "force-dynamic";

const routes = [
  "/",
  "/product",
  "/how-it-works",
  "/assessment",
  "/pricing",
  "/security",
  "/docs",
  "/contact",
  "/terms",
  "/privacy",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getSiteOrigin();
  const paths = [...routes, ...PRODUCT_DOCS.map((doc) => `/docs/${doc.slug}`)];
  return paths.map((path) => ({
    url: new URL(path, origin).toString(),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/assessment" ? 0.9 : 0.7,
  }));
}
