import type { Metadata } from "next";
import Link from "next/link";

import CustomerReview from "../../components/CustomerReview";
import { PUBLIC_DEMO_PAYLOAD } from "../../../lib/public-demo";
import { PUBLIC_DEMO_TOKEN } from "../../../lib/public-demo-token";

export const metadata: Metadata = {
  title: "Public Cut Card demo - PatternProof",
  description: "Explore a synthetic, immutable PatternProof Cut Card with no login.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function PublicDemoCutCard() {
  return (
    <main className="shared-review-page">
      <nav className="nav">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
        <span className="private-badge public-demo-badge">Public demo - read-only</span>
      </nav>
      <CustomerReview
        token={PUBLIC_DEMO_TOKEN}
        initialPayload={PUBLIC_DEMO_PAYLOAD}
      />
    </main>
  );
}