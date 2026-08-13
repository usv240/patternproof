import { createHash } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";

import { PUBLIC_DEMO_RENDER_SHA256, PUBLIC_DEMO_SNAPSHOT_SHA256 } from "../../lib/public-demo";

export const metadata: Metadata = {
  title: "Evidence ledger · PatternProof",
  description: "Public, bounded evidence behind the PatternProof prototype.",
};

const repeatedOutputBytes = 141_631;
const repeatedOutputDigest = "b53062e7e436dbd96379a9f12d23972c8108c3f454e72ff03dd2483245ef43e9";

export default function ProofPage() {
  const assertionDigest = createHash("sha256")
    .update(`${repeatedOutputDigest}:${repeatedOutputBytes}:2`, "utf8")
    .digest("hex");

  return (
    <main className="proof-page">
      <nav className="nav">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
        <Link className="text-link" href="/s/demo-olive">Open frozen demo</Link>
      </nav>
      <header className="proof-hero">
        <p className="eyebrow">Public evidence ledger</p>
        <h1>The proof behind the preview.</h1>
        <p>
          These are bounded, reproducible development observations—not customer impact claims and
          not claims about YouCam&apos;s internal caching policy.
        </p>
      </header>

      <section className="proof-grid" aria-label="PatternProof evidence cards">
        <article className="proof-card proof-highlight">
          <p className="eyebrow">Observed repeatability</p>
          <strong>2 identical requests</strong>
          <span>produced byte-identical results</span>
          <dl>
            <div><dt>SHA-256</dt><dd><code>{repeatedOutputDigest}</code></dd></div>
            <div><dt>Bytes</dt><dd>{repeatedOutputBytes.toLocaleString("en-US")}</dd></div>
            <div><dt>Assertion</dt><dd><code>{assertionDigest.slice(0, 24)}…</code></dd></div>
          </dl>
        </article>

        <article className="proof-card">
          <p className="eyebrow">Transfer stress test</p>
          <strong>3 / 3 recognizable</strong>
          <span>Worn reference · angled/cropped · low-light</span>
          <p>Visual review of synthetic fixtures only; no fit or construction validation.</p>
        </article>

        <article className="proof-card">
          <p className="eyebrow">Private image path</p>
          <strong>Signed URLs passed</strong>
          <span>Private Supabase inputs → YouCam → private persisted output</span>
          <p>No public staging bucket and no service credential in browser code.</p>
        </article>

        <article className="proof-card">
          <p className="eyebrow">Current deterministic demo</p>
          <strong>Frozen and reproducible</strong>
          <dl>
            <div><dt>Render</dt><dd><code>{PUBLIC_DEMO_RENDER_SHA256}</code></dd></div>
            <div><dt>Record</dt><dd><code>{PUBLIC_DEMO_SNAPSHOT_SHA256}</code></dd></div>
          </dl>
        </article>
      </section>

      <section className="integrity-rule">
        <p className="eyebrow">Approval integrity rule</p>
        <h2>Six conditions, or no approval.</h2>
        <ol>
          <li>Exact revision</li><li>Valid preview proof</li><li>Complete human decisions</li>
          <li>No blocked requirement</li><li>Current frozen digest</li><li>Unexpired review link</li>
        </ol>
      </section>

      <aside className="proof-boundary">
        <strong>What this does not prove</strong>
        <p>
          It does not establish provider cache behavior, physical fit, fabric drape, construction
          accuracy, fewer remakes, or customer impact. Those require prospective field evidence.
        </p>
        <Link href="/s/demo-olive" className="button primary">Inspect the frozen proof</Link>
      </aside>
    </main>
  );
}
