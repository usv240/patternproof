import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../../lib/supabase/server";
import TailorWorkspace from "../../components/TailorWorkspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tailor workspace · PatternProof",
  robots: { index: false, follow: false, nocache: true },
};

export default async function BriefWorkspace({
  params,
}: {
  params: Promise<{ briefId: string }>;
}) {
  const { briefId } = await params;
  if (!isSupabaseAuthConfigured()) redirect("/login?next=%2Fbrief");
  const supabase = await createSupabaseServerClient();
  const result = await supabase.auth.getUser();
  if (!result.data.user || result.error) redirect("/login?next=%2Fbrief");

  return (
    <main className="tailor-page">
      <nav className="nav">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
        <div className="dashboard-nav-actions"><Link className="text-link" href="/brief">All Cut Cards</Link><Link className="text-link" href="/brief/new">New Cut Card</Link></div>
      </nav>
      <TailorWorkspace briefId={briefId} />
    </main>
  );
}
