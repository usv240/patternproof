export const FEASIBILITY_STATES = ["as_shown", "with_adjustment", "not_feasible"] as const;
export type FeasibilityStatus = (typeof FEASIBILITY_STATES)[number];

export type Requirement = {
  id: string;
  label: string;
  note?: string;
  status?: FeasibilityStatus;
  tailorNote?: string;
};

export type CutCardRevision = {
  id: string;
  briefId: string;
  version: number;
  referenceUrl: string;
  bodyUrl: string;
  renderUrl?: string;
  requirements: Requirement[];
  customerApprovedAt?: string;
  locked: boolean;
};

export function isReadyForCustomerApproval(revision: CutCardRevision): boolean {
  if (!revision.renderUrl?.trim() || revision.requirements.length === 0) {
    return false;
  }

  return revision.requirements.every((requirement) => {
    if (requirement.status === "as_shown") {
      return true;
    }

    if (requirement.status === "with_adjustment") {
      return Boolean(requirement.tailorNote?.trim());
    }

    return false;
  });
}

export function statusLabel(status: FeasibilityStatus): string {
  return {
    as_shown: "Can make as shown",
    with_adjustment: "Can make with adjustment",
    not_feasible: "Not feasible",
  }[status];
}
