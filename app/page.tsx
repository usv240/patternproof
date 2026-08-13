import Link from "next/link";

import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../lib/supabase/server";

export const dynamic = "force-dynamic";

const steps = [
  ["01", "See the intent", "Start with a garment reference and a customer photo."],
  ["02", "Make it buildable", "A tailor confirms what can be made as shown, adjusted, or not feasibly made."],
  ["03", "Cut with clarity", "The shared, approved Cut Card locks the exact brief before fabric is cut."],
];

export default async function Home() {
  let signedIn = false;
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.getUser();
    signedIn = Boolean(result.data.user && !result.error);
  }
  const newBriefHref = signedIn ? "/brief/new" : "/login?next=%2Fbrief%2Fnew";

  return <main>
    <nav className="nav">
      <Link href="/" className="brand">pattern<span>proof</span></Link>
      <div className="dashboard-nav-actions">
        {signedIn ? (
          <>
            <span className="signed-in-badge">Signed in</span>
            <Link className="text-link" href="/brief">Tailor workspace</Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className="text-button">Sign out</button>
            </form>
          </>
        ) : (
          <Link className="text-link" href="/login?next=%2Fbrief">Tailor sign in</Link>
        )}
      </div>
    </nav>
    <section className="hero">
      <p className="eyebrow">Before fabric becomes irreversible</p>
      <h1>Make sure you both mean<br/><em>the same garment.</em></h1>
      <p className="lede">PatternProof turns inspiration into a tailor-feasibility-checked, customer-approved Cut Card.</p>
      <div className="actions"><Link className="button primary" href="/judge">Enter Judge Mode</Link><Link className="button secondary" href={newBriefHref}>Create a new Cut Card</Link><Link className="text-link" href="/proof">Audit the evidence</Link></div>
      <p className="micro">A visual intent reference — not a fit, construction, or fabric-drape guarantee.</p>
    </section>
    <section className="steps">{steps.map(([n, title, copy]) => <article key={n}><span>{n}</span><h2>{title}</h2><p>{copy}</p></article>)}</section>
  </main>;
}