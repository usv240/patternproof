import { redirect } from "next/navigation";

export default function LegacyJudgePage() {
  redirect("/create#workspace");
}