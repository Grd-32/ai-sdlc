"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";

type SubmissionState = "idle" | "sending" | "success" | "error";

export function ContactForm() {
  const searchParams = useSearchParams();
  const requestedOffer = searchParams.get("offer");
  const offer =
    requestedOffer === "professional" || requestedOffer === "enterprise" ? requestedOffer : "";
  const [state, setState] = useState<SubmissionState>("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setState("sending");
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "We could not submit your enquiry. Please try again later.");
        setState("error");
        return;
      }
      setState("success");
      form.reset();
    } catch {
      setError("We could not reach the enquiry service. Please try again later.");
      setState("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="surface-card space-y-5 p-6 sm:p-8"
      aria-busy={state === "sending"}
    >
      <input type="hidden" name="offer" value={offer} />
      {state === "success" ? (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"
        >
          Your enquiry was sent to the configured Nomalog contact team. They can follow up using the
          email address you provided.
        </div>
      ) : null}
      {state === "error" ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"
        >
          {error}
        </div>
      ) : null}
      <label className="form-label">
        Name
        <input className="form-input" name="name" autoComplete="name" maxLength={120} required />
      </label>
      <label className="form-label">
        Work email
        <input
          className="form-input"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
        />
      </label>
      <label className="form-label">
        Organization <span className="font-normal text-slate-500">(optional)</span>
        <input className="form-input" name="company" autoComplete="organization" maxLength={160} />
      </label>
      <label className="form-label">
        What would you like to discuss?
        <textarea
          className="form-input min-h-32 resize-y"
          name="message"
          minLength={10}
          maxLength={4000}
          required
        />
      </label>
      <div
        className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
        aria-hidden="true"
      >
        <label>
          Leave this field empty
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <p className="text-xs leading-5 text-slate-500">
        Your details are used to respond to your enquiry. Do not include credentials, source code,
        or other sensitive information.
      </p>
      <button
        type="submit"
        className="button-primary w-full justify-center sm:w-auto"
        disabled={state === "sending"}
      >
        {state === "sending" ? (
          <>
            <LoaderCircle className="h-4 w-4 animate-spin" /> Sending…
          </>
        ) : (
          <>
            Send enquiry <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
