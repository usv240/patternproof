export type ExpectationKey = {
  id: "visual" | "craft" | "customer";
  label: string;
  holder: string;
  complete: boolean;
};

export type ExpectationChecksum = {
  keys: readonly ExpectationKey[];
  completed: number;
  total: number;
  released: boolean;
};

export function evaluateExpectationChecksum(input: {
  visualEvidence: boolean;
  craftDecision: boolean;
  customerConsent: boolean;
}): ExpectationChecksum {
  const keys: readonly ExpectationKey[] = [
    {
      id: "visual",
      label: "Body-specific visual evidence",
      holder: "YouCam",
      complete: input.visualEvidence,
    },
    {
      id: "craft",
      label: "Construction promise reviewed",
      holder: "Tailor",
      complete: input.craftDecision,
    },
    {
      id: "customer",
      label: "Exact frozen revision approved",
      holder: "Customer",
      complete: input.customerConsent,
    },
  ];
  const completed = keys.filter((key) => key.complete).length;
  return { keys, completed, total: keys.length, released: completed === keys.length };
}
