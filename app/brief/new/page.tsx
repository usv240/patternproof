import Link from "next/link";
import { redirect } from "next/navigation";

import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../../lib/supabase/server";
import NewBriefForm from "../../components/NewBriefForm";

export const dynamic = "force-dynamic";

export default async function NewBrief() {
  if (!isSupabaseAuthConfigured()) redirect("/create");
  const supabase = await createSupabaseServerClient();
  const result = await supabase.auth.getUser();
  if (!result.data.user || result.error) redirect("/create");

  return (
    <main className="workflow">
      <nav className="nav">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
        <div className="dashboard-nav-actions">
          <Link className="text-link" href="/brief">My Cut Cards</Link>
          <Link className="text-link" href="/create?source=sample">View sample</Link>
        </div>
      </nav>
      <section className="intake">
        <div className="guest-workspace-notice">
          <strong>Private guest workspace</strong>
          <span>No account needed. This browser keeps your isolated workspace; clearing its site data removes your access.</span>
        </div>
        <p className="eyebrow">Step 1 of 5 &middot; choose images</p>
        <h1>Bring the look into focus.</h1>
        <p className="lede">PatternProof validates image quality, rights, and consent before anything is sent to YouCam.</p>
        <NewBriefForm />
      </section>
    </main>
  );
}