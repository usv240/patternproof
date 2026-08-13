export type ReadinessRequirement = {
  status?: "as_shown" | "with_adjustment" | "not_feasible" | null;
  tailorNote?: string | null;
};

export type CutReadinessInput = {
  rightsConfirmed: boolean;
  previewReady: boolean;
  requirements: readonly ReadinessRequirement[];
  snapshotFrozen: boolean;
  customerApproved: boolean;
  changeRequested?: boolean;
};

export type CutReadinessCheck = {
  id: "rights" | "preview" | "decisions" | "feasible" | "snapshot" | "approval";
  label: string;
  complete: boolean;
};

export type CutReadiness = {
  checks: readonly CutReadinessCheck[];
  completed: number;
  total: number;
  state: "not_ready" | "awaiting_customer" | "change_requested" | "cut_ready";
};

function decisionIsComplete(requirement: ReadinessRequirement): boolean {
  if (!requirement.status) return false;
  return requirement.status !== "with_adjustment" || Boolean(requirement.tailorNote?.trim());
}

export function evaluateCutReadiness(input: CutReadinessInput): CutReadiness {
  const hasRequirements = input.requirements.length > 0;
  const decisionsComplete = hasRequirements && input.requirements.every(decisionIsComplete);
  const feasible = decisionsComplete && input.requirements.every(
    (requirement) => requirement.status !== "not_feasible",
  );
  const checks: readonly CutReadinessCheck[] = [
    { id: "rights", label: "Image rights confirmed", complete: input.rightsConfirmed },
    { id: "preview", label: "YouCam preview generated", complete: input.previewReady },
    { id: "decisions", label: "Human decisions complete", complete: decisionsComplete },
    { id: "feasible", label: "No infeasible promises", complete: feasible },
    { id: "snapshot", label: "Agreement snapshot frozen", complete: input.snapshotFrozen },
    { id: "approval", label: "Customer approval recorded", complete: input.customerApproved },
  ];
  const completed = checks.filter((check) => check.complete).length;
  return {
    checks,
    completed,
    total: checks.length,
    state: input.changeRequested
      ? "change_requested"
      : input.customerApproved && completed === checks.length
        ? "cut_ready"
      : input.snapshotFrozen && feasible
        ? "awaiting_customer"
        : "not_ready",
  };
}
