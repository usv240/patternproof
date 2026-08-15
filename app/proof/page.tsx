import { createHash } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";

import { evaluateExpectationChecksum } from "../../lib/expectation-checksum";
import { PUBLIC_DEMO_RENDER_SHA256, PUBLIC_DEMO_SNAPSHOT_SHA256 } from "../../lib/public-demo";
import ExpectationChecksum from "../components/ExpectationChecksum";

export const metadata: Metadata = {
  title: "Evidence ledger · PatternProof",
  description: "Public, bounded evidence behind the PatternProof prototype.",
};

const repeatedOutputBytes = 141_631;
const repeatedOutputDigest = "b53062e7e436dbd96379a9f12d23972c8108c3f454e72ff03dd2483245ef43e9";

export default function ProofPage() {
  const expectationChecksum = evaluateExpectationChecksum({
    visualEvidence: true,
    craftDecision: true,
    customerConsent: true,
  });
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

      <section className="proof-problem" aria-labelledby="proof-problem-heading">
        <div className="proof-problem-copy">
          <p className="eyebrow">Problem evidence</p>
          <h2 id="proof-problem-heading">Expectation mismatch appears before an irreversible cut.</h2>
        </div>
        <ul className="proof-problem-metrics" aria-label="Bounded research sample">
          <li><strong>108</strong><span>complaints</span></li>
          <li><strong>41</strong><span>businesses</span></li>
          <li><strong>3</strong><span>Indian cities</span></li>
          <li><strong>Expectation mismatch</strong><span>recurring signal</span></li>
        </ul>
        <p className="proof-problem-caveat">Bounded negative sample &middot; not prevalence</p>
      </section>

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

      <section className="integrity-rule sponsor-chain" aria-labelledby="sponsor-chain-heading">
        <p className="eyebrow">Apparel evidence chain</p>
        <h2 id="sponsor-chain-heading">Four YouCam jobs. Four controlled moments.</h2>
        <ol>
          <li><strong>Background Removal</strong><small>Reference rescue before preview · 1 unit</small></li>
          <li><strong>Clothes VTO V3</strong><small>Core body-specific visual · 2 units</small></li>
          <li><strong>Fabric VTO</strong><small>Predefined direction before human review · 2 units</small></li>
          <li><strong>Image-to-Video V2</strong><small>Five-second proof after approval · 5 units</small></li>
        </ol>
        <p className="sponsor-chain-boundary">
          Fabric is not an uploaded swatch or drape simulation. Motion is presentation-only and
          never changes the frozen construction checksum. One database circuit breaker and a
          12-unit guest ceiling bound the complete 10-unit chain.
        </p>
      </section>
      <ExpectationChecksum
        checksum={expectationChecksum}
        proof={PUBLIC_DEMO_SNAPSHOT_SHA256.slice(0, 18)}
      />

      <section className="integrity-rule">
        <p className="eyebrow">Evidence completeness beneath the three-key gate</p>
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
