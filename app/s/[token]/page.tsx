import type { Metadata } from "next";
import Link from "next/link";

import CustomerReview from "../../components/CustomerReview";
import { isPublicDemoToken } from "../../../lib/public-demo-token";

export const metadata: Metadata = {
  title: "Cut Card review - PatternProof",
  description: "Review a private visual-intent brief before fabric is cut.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function SharedCutCard({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const publicDemo = isPublicDemoToken(token);

  return (
    <main className="shared-review-page">
      <nav className="nav">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
        <span className={publicDemo ? "private-badge public-demo-badge" : "private-badge"}>
          {publicDemo ? "Public demo - read-only" : "Private review"}
        </span>
      </nav>
      <CustomerReview token={token} />
    </main>
  );
}
