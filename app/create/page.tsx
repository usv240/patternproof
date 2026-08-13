import Image from "next/image";
import Link from "next/link";

import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../lib/supabase/server";
import SampleCutCard from "../components/SampleCutCard";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Create a Cut Card | PatternProof",
  description: "Start with a rights-cleared sample or privately upload your own customer and garment photos.",
};

export default async function CreateCutCardPage() {
  let signedIn = false;
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.getUser();
    signedIn = Boolean(result.data.user && !result.error);
  }
  const privateIntakeHref = signedIn
    ? "/brief/new"
    : "/login?next=%2Fbrief%2Fnew";

  return (
    <main className="workflow">
      <nav className="nav">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
        <div className="dashboard-nav-actions">
          <Link className="text-link" href="/proof">Technical proof</Link>
          {signedIn ? (
            <Link className="text-link" href="/brief">Tailor workspace</Link>
          ) : (
            <Link className="text-link" href="/login?next=%2Fbrief">Tailor sign in</Link>
          )}
        </div>
      </nav>

      <section className="create-entry" aria-labelledby="create-title">
        <header className="create-entry-header">
          <div>
            <p className="eyebrow">Create a Cut Card</p>
            <h1 id="create-title">Choose the images.<br/>Keep one agreement.</h1>
          </div>
          <p>
            Both paths use the same PatternProof workflow. Explore a ready, rights-cleared
            sample immediately—or sign in to process private customer photos.
          </p>
        </header>

        <div className="source-grid" aria-label="Choose an image source">
          <a className="source-card source-card-sample" href="#workspace">
            <div className="source-thumbnails" aria-hidden="true">
              <Image src="/demo/reference-olive.jpg" alt="" width={180} height={240} priority />
              <Image src="/demo/render-olive.jpg" alt="" width={180} height={240} priority />
            </div>
            <div className="source-card-copy">
              <span className="source-kicker">Ready sample</span>
              <h2>Use sample photos</h2>
              <p>Explore preview, feasibility, customer consent, locking, and privacy exit.</p>
              <strong>Start immediately <span aria-hidden="true">↓</span></strong>
              <small>No sign-in · no database writes · no API spend</small>
            </div>
          </a>

          <Link className="source-card source-card-private" href={privateIntakeHref}>
            <div className="private-source-visual" aria-hidden="true">
              <span>01</span><i></i><span>02</span>
              <strong>Private image pair</strong>
            </div>
            <div className="source-card-copy">
              <span className="source-kicker">Private workspace</span>
              <h2>Use my photos</h2>
              <p>Upload a customer photo and garment reference, then create a live YouCam preview.</p>
              <strong>{signedIn ? "Continue to private intake →" : "Sign in to continue →"}</strong>
              <small>Consent first · normalized private uploads · bounded API use</small>
            </div>
          </Link>
        </div>
      </section>

      <div id="workspace" className="sample-workspace">
        <SampleCutCard />
      </div>
    </main>
  );
}