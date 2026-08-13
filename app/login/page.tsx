import Link from "next/link";
import { redirect } from "next/navigation";

import { safePostAuthPath } from "../../lib/security/app-origin";
import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../lib/supabase/server";
import MagicLinkForm from "../components/MagicLinkForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const nextPath = safePostAuthPath((await searchParams).next);
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.getUser();
    if (result.data.user && !result.error) redirect(nextPath);
  }
  return (
    <main className="workflow">
      <nav className="nav">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
      </nav>
      <section className="login-panel">
        <p className="eyebrow">Tailor workspace</p>
        <h1>Sign in without a password.</h1>
        <p className="lede">We will send a one-time link. Customers never need an account.</p>
        <MagicLinkForm nextPath={nextPath} />
      </section>
    </main>
  );
}