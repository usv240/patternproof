import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  createSupabaseServerClient,
  isSupabaseAuthConfigured,
} from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cut Cards · PatternProof",
  robots: { index: false, follow: false, nocache: true },
};

type BriefRow = {
  id: string;
  customer_label: string;
  status: string;
  created_at: string;
  shared_revision_id: string | null;
  approved_revision_id: string | null;
};

type RevisionRow = {
  id: string;
  brief_id: string;
  version: number;
  created_at: string;
};

const statusLabels: Record<string, string> = {
  draft: "Draft intake",
  awaiting_tailor: "Tailor review",
  awaiting_customer: "With customer",
  approved: "Approved",
  archived: "Archived",
};

function displayDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export default async function BriefDashboard() {
  if (!isSupabaseAuthConfigured()) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const userResult = await supabase.auth.getUser();
  if (userResult.error || !userResult.data.user) redirect("/login?next=%2Fbrief");

  const briefResult = await supabase
    .from("brief")
    .select("id, customer_label, status, created_at, shared_revision_id, approved_revision_id")
    .order("created_at", { ascending: false })
    .limit(100);
  if (briefResult.error) throw briefResult.error;

  const briefs = (briefResult.data ?? []) as BriefRow[];
  const briefIds = briefs.map((brief) => brief.id);
  const revisionResult = briefIds.length
    ? await supabase
        .from("revision")
        .select("id, brief_id, version, created_at")
        .in("brief_id", briefIds)
        .order("version", { ascending: false })
    : { data: [] as RevisionRow[], error: null };
  if (revisionResult.error) throw revisionResult.error;

  const latestByBrief = new Map<string, RevisionRow>();
  for (const revision of (revisionResult.data ?? []) as RevisionRow[]) {
    if (!latestByBrief.has(revision.brief_id)) latestByBrief.set(revision.brief_id, revision);
  }

  return (
    <main className="workflow">
      <nav className="nav">
        <Link href="/" className="brand">pattern<span>proof</span></Link>
        <div className="dashboard-nav-actions">
          <Link className="text-link" href="/brief/new">New Cut Card</Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-button">Sign out</button>
          </form>
        </div>
      </nav>

      <section className="brief-dashboard">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Private tailor workspace</p>
            <h1>Your Cut Cards.</h1>
            <p>Resume a feasibility review, retrieve an approved record, or start fresh.</p>
          </div>
          <Link className="button primary" href="/brief/new">Create Cut Card</Link>
        </header>

        {briefs.length ? (
          <div className="brief-list">
            {briefs.map((brief) => {
              const revision = latestByBrief.get(brief.id);
              const approved = brief.status === "approved" || Boolean(brief.approved_revision_id);
              return (
                <Link className="brief-card" href={`/brief/${brief.id}`} key={brief.id}>
                  <div>
                    <span className="eyebrow">{displayDate(brief.created_at)}</span>
                    <h2>{brief.customer_label}</h2>
                    <p>
                      {revision ? `Revision ${revision.version}` : "Intake pending"}
                      {brief.shared_revision_id && !approved ? " · frozen for customer" : ""}
                    </p>
                  </div>
                  <span className={approved ? "state locked" : "state"}>
                    {statusLabels[brief.status] ?? brief.status.replaceAll("_", " ")}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-empty">
            <h2>No Cut Cards yet.</h2>
            <p>Your first private brief takes about two minutes to prepare.</p>
            <Link className="button primary" href="/brief/new">Start the first one</Link>
          </div>
        )}
      </section>
    </main>
  );
}
