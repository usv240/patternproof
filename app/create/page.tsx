import Link from "next/link";

import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../lib/supabase/server";
import CutCardEntry from "../components/CutCardEntry";

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

  return (
    <main className="workflow">
      <nav className="nav">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
        <div className="dashboard-nav-actions">
          <Link className="text-link" href="/proof">Technical proof</Link>
          {signedIn ? (
            <Link className="text-link" href="/brief">Tailor workspace</Link>
          ) : (
            <span className="private-by-default">No account needed</span>
          )}
        </div>
      </nav>
      <CutCardEntry />
    </main>
  );
}