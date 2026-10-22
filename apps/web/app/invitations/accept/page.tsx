import { Suspense } from "react";
import { AcceptInvitation } from "../accept-invitation";

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={<main className="p-8">Loading invitation…</main>}>
      <AcceptInvitation />
    </Suspense>
  );
}
