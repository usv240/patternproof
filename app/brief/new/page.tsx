import Link from "next/link";
import { redirect } from "next/navigation";

import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../../lib/supabase/server";
import NewBriefForm from "../../components/NewBriefForm";

export const dynamic = "force-dynamic";

export default async function NewBrief() {
  if (!isSupabaseAuthConfigured()) redirect("/login?next=%2Fbrief%2Fnew");
  const supabase = await createSupabaseServerClient();
  const result = await supabase.auth.getUser();
  if (!result.data.user || result.error) redirect("/login?next=%2Fbrief%2Fnew");

  return <main className="workflow"><nav className="nav"><Link href="/" className="brand">pattern<span>proof</span></Link><div className="dashboard-nav-actions"><Link className="text-link" href="/brief">All Cut Cards</Link><Link className="text-link" href="/demo">Example</Link></div></nav><section className="intake"><p className="eyebrow">New brief · input check</p><h1>Bring the look into focus.</h1><p className="lede">PatternProof validates the image and consent before it sends anything to AI.</p><NewBriefForm /></section></main>;
}