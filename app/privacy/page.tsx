import type { Metadata } from "next";
import Link from "next/link";

import { hasValidPrivacyContact } from "../../lib/release-readiness";

export const metadata: Metadata = {
  title: "Privacy notice — PatternProof",
  description: "How PatternProof handles customer photos, garment references, and approval evidence.",
};

export const dynamic = "force-dynamic";

function configuredContact(): string | null {
  const value = process.env.PRIVACY_CONTACT_EMAIL?.trim() ?? "";
  return hasValidPrivacyContact(value) ? value : null;
}

export default function PrivacyPage() {
  const contact = configuredContact();

  return (
    <main>
      <nav className="nav" aria-label="Primary navigation">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
        <Link className="text-link" href="/">Back home</Link>
      </nav>

      <article className="privacy-page">
        <header>
          <p className="eyebrow">Plain-language data practice</p>
          <h1>Privacy notice</h1>
          <p className="privacy-updated">Effective August 3, 2026</p>
          <p className="privacy-summary">
            PatternProof uses a customer body photo, a garment reference, and tailoring
            decisions to create one private visual-intent record. It does not sell those
            images or use them for advertising.
          </p>
        </header>

        <section>
          <h2>Who is responsible</h2>
          <p>
            The tailor or shop that creates a brief decides why the customer information is
            used and is the first contact for requests about that brief. The PatternProof
            deployment operator provides the application and its processors.
          </p>
        </section>

        <section>
          <h2>What we process</h2>
          <ul>
            <li>the shop owner&apos;s authentication email and shop name;</li>
            <li>a customer label, body photo, and garment reference image;</li>
            <li>garment category, requirements, feasibility decisions, adjustments, and notes;</li>
            <li>an AI-generated visual-intent preview and cryptographic image digests;</li>
            <li>consent and image-rights confirmations; and</li>
            <li>review-link state, approval name, timestamps, and frozen approval evidence.</li>
          </ul>
          <p>
            Please use a customer label rather than a full legal name during intake, and do not
            upload identification documents, medical images, or unrelated sensitive material.
          </p>
        </section>

        <section>
          <h2>Why and how it is used</h2>
          <p>
            The information is used only to validate private uploads, generate a YouCam garment
            preview, let the tailor record construction feasibility, and let the customer review
            the exact frozen Cut Card before approval. The preview communicates visual intent;
            it is not a fit, measurement, construction, fabric-behavior, or final-appearance
            guarantee.
          </p>
          <p>
            Originals are uploaded to private temporary storage. The server validates and
            normalizes accepted images, removes embedded metadata, and keeps private canonical
            copies. YouCam receives short-lived signed input links for preview generation. Its
            returned image is downloaded, validated, normalized, and re-hosted privately.
          </p>
        </section>

        <section>
          <h2>Retention and deletion</h2>
          <div className="privacy-table" role="table" aria-label="Data retention summary">
            <div role="row">
              <strong role="columnheader">Record</strong>
              <strong role="columnheader">Treatment</strong>
            </div>
            <div role="row">
              <span role="cell">Temporary originals</span>
              <span role="cell">
                Deleted after successful normalization. An unfinished intake grant expires after
                two hours; the maintenance worker retries cleanup. On a once-daily scheduler,
                actual cleanup can occur after that expiry window.
              </span>
            </div>
            <div role="row">
              <span role="cell">Normalized body photo</span>
              <span role="cell">
                Kept privately while needed for the brief. After approval or archival, the shop
                can start an audited erasure that is retried until storage deletion succeeds.
              </span>
            </div>
            <div role="row">
              <span role="cell">Reference, preview, and Cut Card</span>
              <span role="cell">
                Kept as the working brief and agreement record under the shop&apos;s retention
                responsibilities. Reviewed evidence is protected from silent mutation.
              </span>
            </div>
            <div role="row">
              <span role="cell">Review and approval evidence</span>
              <span role="cell">
                A frozen snapshot, digest, consent assertions, requirements, decisions, approval
                name, and timestamps remain as integrity evidence even after body-photo erasure.
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2>Who receives data</h2>
          <p>
            Supabase provides authentication, PostgreSQL, and private object storage. YouCam
            processes the two input images to generate the visual preview. The deployment host
            (for the reference deployment, Vercel) handles application requests and operational
            logs. A customer with the unexpired private review link can see only that frozen
            review. PatternProof does not include advertising or product-analytics SDKs.
          </p>
        </section>

        <section>
          <h2>Your choices</h2>
          <p>
            A body photo is not processed until the intake user confirms customer consent and
            permission to use the garment reference. Do not continue if either confirmation is
            missing. A customer can decline approval and ask the shop to withdraw the review.
            Contact the shop that created the brief to request access, correction, withdrawal,
            or eligible body-photo erasure.
          </p>
          <p>
            For deployment-level privacy or security requests, contact{" "}
            {contact ? (
              <a href={`mailto:${contact}`}>{contact}</a>
            ) : (
              <strong>the deployment operator through its published support channel</strong>
            )}.
          </p>
        </section>

        <section>
          <h2>Security and link safety</h2>
          <p>
            Images live in a private bucket and are served through short-lived signed URLs.
            Customer review links are bearer links: anyone who receives one may be able to view
            the frozen Cut Card until it expires or is withdrawn, so recipients should not
            forward it. Raw review tokens are not stored in the database. No internet service can
            promise absolute security; suspected link or account exposure should be reported
            promptly.
          </p>
        </section>

        <section>
          <h2>Changes</h2>
          <p>
            Material changes will be reflected here with a new effective date. New processing
            purposes require an updated notice and, where required, renewed consent.
          </p>
        </section>
      </article>
    </main>
  );
}
