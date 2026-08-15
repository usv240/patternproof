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
const repository = "https://github.com/usv240/patternproof";

const evidenceSources = [
  {
    level: "Recorded observation",
    title: "Problem research protocol",
    description:
      "Aggregate coding tables, inclusion rules, exclusions, and limitations for the 108-complaint formative sample. Exact reviews and identities are withheld for research ethics.",
    href: `${repository}/blob/main/RESEARCH.md`,
    linkLabel: "Inspect research record",
  },
  {
    level: "Recorded observation",
    title: "YouCam validation log",
    description:
      "T0-T7 timings, the 3/3 synthetic stress review, signed-URL result, repeat digest, and explicit claim boundaries. Secrets and provider task IDs are omitted.",
    href: `${repository}/blob/main/D1-RESULTS.md`,
    linkLabel: "Inspect validation record",
  },
  {
    level: "Independently verifiable",
    title: "Pinned public assets",
    description:
      "Rights, provenance, byte sizes, and SHA-256 hashes for the frozen demo inputs and output. Clone the repository and hash the files yourself.",
    href: `${repository}/blob/main/ASSETS.md`,
    linkLabel: "Inspect asset manifest",
  },
  {
    level: "Re-runnable with credentials",
    title: "Hosted acceptance chain",
    description:
      "A sanitized transcript of the production run plus the exact four-feature harness. Re-running the provider portion requires an authorized YouCam key and 10 units.",
    href: `${repository}/blob/main/evidence/production-acceptance-20260814.txt`,
    secondaryHref: `${repository}/blob/main/scripts/live-evidence-acceptance.ps1`,
    linkLabel: "Inspect acceptance transcript",
    secondaryLabel: "Inspect harness",
  },
  {
    level: "Independently verifiable",
    title: "Executable contracts",
    description:
      "Regression tests bind the published hashes, exact demo-token boundary, four YouCam endpoints, unit costs, and the approval gate to the implementation.",
    href: `${repository}/tree/main/tests`,
    linkLabel: "Inspect regression suite",
  },
  {
    level: "Primary reference",
    title: "Official YouCam API documentation",
    description:
      "Perfect Corp's own Apparel VTO and AI API references provide the external feature definitions. PatternProof's measured results remain separately labeled above.",
    href: "https://yce.perfectcorp.com/ai-api/contents/clothes-api",
    secondaryHref: "https://yce.perfectcorp.com/en-us/ai-api",
    linkLabel: "Open Clothes VTO reference",
    secondaryLabel: "Open AI API catalog",
  },
] as const;

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

      <section className="proof-sources" aria-labelledby="proof-sources-heading">
        <header className="proof-sources-header">
          <p className="eyebrow">Sources and reproduction</p>
          <h2 id="proof-sources-heading">Inspect the evidence, not just the claim.</h2>
          <p>
            Every source below states its evidence level. Published files and code can be checked
            independently; live-provider and manual-review results are accurately labeled as
            recorded observations.
          </p>
        </header>
        <div className="proof-source-grid">
          {evidenceSources.map((source) => (
            <article className="proof-source-card" key={source.title}>
              <span className="proof-source-level">{source.level}</span>
              <h3>{source.title}</h3>
              <p>{source.description}</p>
              <div className="proof-source-links">
                <a href={source.href} target="_blank" rel="noreferrer">{source.linkLabel} &rarr;</a>
                {"secondaryHref" in source ? (
                  <a href={source.secondaryHref} target="_blank" rel="noreferrer">
                    {source.secondaryLabel} &rarr;
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
        <div className="proof-reproduce">
          <strong>Fast independent checks after cloning</strong>
          <code>npm run check</code>
          <code>sha256sum public/demo/render-olive.jpg</code>
        </div>
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
