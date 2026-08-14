import Link from "next/link";

import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../lib/supabase/server";

export const dynamic = "force-dynamic";

const steps = [
  ["01", "See the intent", "Start with a garment reference and a customer photo."],
  ["02", "Make it buildable", "A tailor confirms what can be made as shown, adjusted, or not feasibly made."],
  ["03", "Turn three keys", "YouCam evidence, tailor judgment, and customer consent release one checksum-bound Cut Card."],
];

export default async function Home() {
  let signedIn = false;
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.getUser();
    signedIn = Boolean(result.data.user && !result.error);
  }

  return <main>
    <nav className="nav">
      <Link href="/" className="brand">pattern<span>proof</span></Link>
      <div className="dashboard-nav-actions">
        {signedIn && <Link className="text-link" href="/brief">My Cut Cards</Link>}
        <Link className="text-link" href="/proof">Technical proof</Link>
      </div>
    </nav>
    <section className="hero">
      <p className="eyebrow">Before fabric becomes irreversible</p>
      <h1>Make sure you both mean{" "}<br/><em>the same garment.</em></h1>
      <p className="lede">PatternProof is a three-key production interlock: AI evidence, craft judgment, and customer consent must agree before the cut.</p>
      <div className="actions"><Link className="button primary" href="/create">Create a Cut Card</Link><Link className="text-link" href="/proof">View technical proof</Link></div>
      <p className="micro">A visual intent reference &mdash; not a fit, construction, or fabric-drape guarantee.</p>
    </section>
    <section className="process-section" aria-labelledby="process-title">
      <div className="process-inner">
        <header className="process-heading">
          <div>
            <p className="eyebrow">The release sequence</p>
            <h2 id="process-title">One shared intent.{" "}<br/>Three keys before the cut.</h2>
          </div>
          <p>PatternProof makes the handoff visible: first see the intended garment, then record what can actually be built, and only then ask the customer to release the approved Cut Card.</p>
        </header>
        <div className="steps">
          {steps.map(([n, title, copy]) => (
            <article key={n}>
              <span>{n}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  </main>;
}