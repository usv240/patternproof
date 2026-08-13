import Link from "next/link";
import JudgeMode from "../components/JudgeMode";
export const metadata = { title: "Judge Mode | PatternProof", description: "A guided, evidence-backed tour of PatternProof's consent-to-cut workflow." };
export default function JudgePage() {
  return <main className="workflow"><nav className="nav"><Link href="/" className="brand">pattern<span>proof</span></Link><div className="dashboard-nav-actions"><Link className="text-link" href="/proof">Evidence</Link><Link className="text-link" href="/s/demo-olive">Public Cut Card</Link></div></nav><JudgeMode /></main>;
}