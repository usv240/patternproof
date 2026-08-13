import { redirect } from "next/navigation";

export default function LegacyDemoPage() {
  redirect("/create?source=sample");
}