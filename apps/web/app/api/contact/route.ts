import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type ContactSubmission = {
  name: string;
  email: string;
  company: string;
  message: string;
  offer: string;
  website: string;
};

const WINDOW_MS = 60 * 60 * 1000;
const MAX_SUBMISSIONS_PER_WINDOW = 5;
const rateLimit = new Map<string, { count: number; resetAt: number }>();

function response(status: number, error?: string) {
  return NextResponse.json(error ? { error } : { accepted: true }, { status });
}

function getClientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const client = forwarded || request.headers.get("x-real-ip") || "unknown-client";
  return createHash("sha256").update(client).digest("hex");
}

function isContactSubmission(value: unknown): value is ContactSubmission {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["name", "email", "company", "message", "offer", "website"].every(
    (key) => typeof record[key] === "string",
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expectedOrigin = process.env["APP_URL"]
    ? new URL(process.env["APP_URL"]).origin
    : request.nextUrl.origin;
  const origin = request.headers.get("origin");
  const localBrowserOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin ?? "");
  if (origin !== expectedOrigin && origin !== request.nextUrl.origin && !localBrowserOrigin) {
    return response(403, "This request could not be verified.");
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return response(415, "Submit the enquiry using the website form.");
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) return response(413, "The enquiry is too large.");

  let body = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) return response(400, "Enter a valid enquiry.");
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
      if (new TextEncoder().encode(body).byteLength > 16_384) {
        await reader.cancel();
        return response(413, "The enquiry is too large.");
      }
    }
    body += decoder.decode();
  } catch {
    return response(400, "Enter a valid enquiry.");
  }

  let submitted: unknown;
  try {
    submitted = JSON.parse(body);
  } catch {
    return response(400, "Enter a valid enquiry.");
  }
  if (!isContactSubmission(submitted)) return response(400, "Enter a valid enquiry.");

  const name = submitted.name.trim();
  const email = submitted.email.trim().toLowerCase();
  const company = submitted.company?.trim() ?? "";
  const message = submitted.message.trim();
  const offer = submitted.offer.trim().toLowerCase();
  if (
    name.length < 1 ||
    name.length > 120 ||
    !isValidEmail(email) ||
    email.length > 254 ||
    company.length > 160 ||
    message.length < 10 ||
    message.length > 4000 ||
    !["", "professional", "enterprise"].includes(offer)
  ) {
    return response(400, "Check the name, email, organization, and message fields.");
  }

  const now = Date.now();
  for (const [key, entry] of rateLimit) {
    if (entry.resetAt <= now) rateLimit.delete(key);
  }
  if (rateLimit.size >= 10_000) {
    const oldestKey = rateLimit.keys().next().value;
    if (oldestKey) rateLimit.delete(oldestKey);
  }
  const clientKey = getClientKey(request);
  const current = rateLimit.get(clientKey);
  if (current && current.resetAt > now && current.count >= MAX_SUBMISSIONS_PER_WINDOW) {
    return response(429, "Too many enquiries. Please try again later.");
  }
  rateLimit.set(
    clientKey,
    current && current.resetAt > now
      ? { count: current.count + 1, resetAt: current.resetAt }
      : { count: 1, resetAt: now + WINDOW_MS },
  );

  if (submitted.website.trim()) return response(202);

  const webhookUrl = process.env["CONTACT_WEBHOOK_URL"];
  const webhookToken = process.env["CONTACT_WEBHOOK_TOKEN"];
  if (!webhookUrl || !webhookToken) {
    return response(
      503,
      "The enquiry service is not configured. Please contact the site operator.",
    );
  }

  let target: URL;
  try {
    target = new URL(webhookUrl);
  } catch {
    console.error("[contact] CONTACT_WEBHOOK_URL is invalid");
    return response(503, "The enquiry service is temporarily unavailable.");
  }
  if (target.protocol !== "https:") {
    console.error("[contact] CONTACT_WEBHOOK_URL must use HTTPS");
    return response(503, "The enquiry service is temporarily unavailable.");
  }

  try {
    const delivery = await fetch(target, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${webhookToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        email,
        company,
        message,
        offer,
        submittedAt: new Date(now).toISOString(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!delivery.ok) {
      console.error("[contact] contact provider rejected enquiry", { status: delivery.status });
      return response(502, "The enquiry could not be delivered. Please try again later.");
    }
  } catch (error) {
    console.error("[contact] contact provider delivery failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return response(502, "The enquiry could not be delivered. Please try again later.");
  }

  return response(202);
}
