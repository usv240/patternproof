import Link from "next/link";
import DemoWorkflow from "../components/DemoWorkflow";

export default function DemoPage() {
  return <main className="workflow"><nav className="nav"><Link href="/" className="brand">pattern<span>proof</span></Link><div className="dashboard-nav-actions"><Link className="text-link" href="/judge">Judge Mode</Link><Link className="text-link" href="/s/demo-olive">View locked example</Link></div></nav><DemoWorkflow /></main>;
}
