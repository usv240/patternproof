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

type CreateCutCardPageProps = { searchParams: Promise<{ source?: string }> };

export default async function CreateCutCardPage({ searchParams }: CreateCutCardPageProps) {
  const query = await searchParams;
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
      <CutCardEntry
        privateIntakeHref={privateIntakeHref}
        signedIn={signedIn}
        initialSource={query.source === "sample" ? "sample" : "choose"}
      />
    </main>
  );
}