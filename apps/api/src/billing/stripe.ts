import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("Stripe billing is not configured (STRIPE_SECRET_KEY is missing).");
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

export function getStripeWebhookSecret(): string {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret) throw new Error("Stripe webhook processing is not configured.");
  return secret;
}

export function getAppBaseUrl(): string {
  const value = process.env["APP_URL"] ?? "http://localhost:3000";
  return new URL(value).origin;
}
