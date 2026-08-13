export type PilotPhase = "baseline" | "patternproof";

export type PilotRecord = {
  recordId: string;
  studioCode: string;
  phase: PilotPhase;
  completed: boolean;
  clarificationCycles: number;
  agreementMinutes: number | null;
  preCutChange: boolean;
  postApprovalChange: boolean;
  expectationRelatedRework: boolean;
  customerConfidence: number | null;
  tailorConfidence: number | null;
};

type PhaseMetrics = {
  records: number;
  completed: number;
  completionRate: number;
  medianClarificationCycles: number;
  medianAgreementMinutes: number | null;
  preCutChangeRate: number;
  postApprovalChangeRate: number;
  expectationRelatedReworkRate: number;
  meanCustomerConfidence: number | null;
  meanTailorConfidence: number | null;
};

export type PilotReport = {
  status: "descriptive_only";
  studios: number;
  records: number;
  baseline: PhaseMetrics;
  patternproof: PhaseMetrics;
  descriptiveDifference: {
    completionRatePoints: number;
    medianClarificationCycles: number;
    medianAgreementMinutes: number | null;
    preCutChangeRatePoints: number;
    postApprovalChangeRatePoints: number;
    expectationRelatedReworkRatePoints: number;
  };
  caveat: string;
};

const exactKeys = new Set<keyof PilotRecord>([
  "recordId", "studioCode", "phase", "completed", "clarificationCycles",
  "agreementMinutes", "preCutChange", "postApprovalChange",
  "expectationRelatedRework", "customerConfidence", "tailorConfidence",
]);
const safeCode = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

function assertObject(value: unknown, index: number): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Record ${index + 1} must be an object.`);
  }
}

function assertBoolean(value: unknown, field: string, index: number): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`Record ${index + 1} field ${field} must be boolean.`);
  }
}

function assertCount(value: unknown, field: string, index: number): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 50) {
    throw new TypeError(`Record ${index + 1} field ${field} must be an integer from 0 to 50.`);
  }
}

function assertOptionalScale(value: unknown, field: string, index: number): void {
  if (value !== null && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5)) {
    throw new TypeError(`Record ${index + 1} field ${field} must be null or an integer from 1 to 5.`);
  }
}

export function parsePilotRecords(value: unknown): PilotRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Pilot data must be a non-empty array.");
  }
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    assertObject(candidate, index);
    const unknownKeys = Object.keys(candidate).filter((key) => !exactKeys.has(key as keyof PilotRecord));
    if (unknownKeys.length > 0) {
      throw new TypeError(`Record ${index + 1} contains unsupported fields: ${unknownKeys.join(", ")}. Do not put personal data in this file.`);
    }
    if (typeof candidate.recordId !== "string" || !safeCode.test(candidate.recordId)) {
      throw new TypeError(`Record ${index + 1} needs a de-identified recordId.`);
    }
    if (seen.has(candidate.recordId)) throw new TypeError(`Duplicate recordId: ${candidate.recordId}.`);
    seen.add(candidate.recordId);
    if (typeof candidate.studioCode !== "string" || !safeCode.test(candidate.studioCode)) {
      throw new TypeError(`Record ${index + 1} needs a de-identified studioCode.`);
    }
    if (candidate.phase !== "baseline" && candidate.phase !== "patternproof") {
      throw new TypeError(`Record ${index + 1} phase must be baseline or patternproof.`);
    }
    assertBoolean(candidate.completed, "completed", index);
    assertCount(candidate.clarificationCycles, "clarificationCycles", index);
    if (candidate.agreementMinutes !== null && (typeof candidate.agreementMinutes !== "number" || !Number.isFinite(candidate.agreementMinutes) || candidate.agreementMinutes < 0 || candidate.agreementMinutes > 1_440)) {
      throw new TypeError(`Record ${index + 1} agreementMinutes must be null or 0 through 1440.`);
    }
    if (!candidate.completed && candidate.agreementMinutes !== null) {
      throw new TypeError(`Record ${index + 1} cannot have agreementMinutes when incomplete.`);
    }
    assertBoolean(candidate.preCutChange, "preCutChange", index);
    assertBoolean(candidate.postApprovalChange, "postApprovalChange", index);
    assertBoolean(candidate.expectationRelatedRework, "expectationRelatedRework", index);
    assertOptionalScale(candidate.customerConfidence, "customerConfidence", index);
    assertOptionalScale(candidate.tailorConfidence, "tailorConfidence", index);
    return candidate as PilotRecord;
  });
}

function rounded(value: number): number { return Math.round(value * 1_000) / 1_000; }
function rate(records: PilotRecord[], predicate: (record: PilotRecord) => boolean): number {
  return rounded(records.filter(predicate).length / records.length);
}
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? rounded((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}
function mean(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : rounded(present.reduce((total, value) => total + value, 0) / present.length);
}
function summarize(records: PilotRecord[]): PhaseMetrics {
  const completed = records.filter((record) => record.completed).length;
  return {
    records: records.length,
    completed,
    completionRate: rounded(completed / records.length),
    medianClarificationCycles: median(records.map((record) => record.clarificationCycles)) ?? 0,
    medianAgreementMinutes: median(records.flatMap((record) => record.agreementMinutes === null ? [] : [record.agreementMinutes])),
    preCutChangeRate: rate(records, (record) => record.preCutChange),
    postApprovalChangeRate: rate(records, (record) => record.postApprovalChange),
    expectationRelatedReworkRate: rate(records, (record) => record.expectationRelatedRework),
    meanCustomerConfidence: mean(records.map((record) => record.customerConfidence)),
    meanTailorConfidence: mean(records.map((record) => record.tailorConfidence)),
  };
}
function difference(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : rounded(left - right);
}

export function buildPilotReport(records: PilotRecord[]): PilotReport {
  const baselineRecords = records.filter((record) => record.phase === "baseline");
  const patternProofRecords = records.filter((record) => record.phase === "patternproof");
  if (baselineRecords.length === 0 || patternProofRecords.length === 0) {
    throw new TypeError("Pilot data needs at least one baseline and one PatternProof record.");
  }
  const baseline = summarize(baselineRecords);
  const patternproof = summarize(patternProofRecords);
  return {
    status: "descriptive_only",
    studios: new Set(records.map((record) => record.studioCode)).size,
    records: records.length,
    baseline,
    patternproof,
    descriptiveDifference: {
      completionRatePoints: rounded(patternproof.completionRate - baseline.completionRate),
      medianClarificationCycles: rounded(patternproof.medianClarificationCycles - baseline.medianClarificationCycles),
      medianAgreementMinutes: difference(patternproof.medianAgreementMinutes, baseline.medianAgreementMinutes),
      preCutChangeRatePoints: rounded(patternproof.preCutChangeRate - baseline.preCutChangeRate),
      postApprovalChangeRatePoints: rounded(patternproof.postApprovalChangeRate - baseline.postApprovalChangeRate),
      expectationRelatedReworkRatePoints: rounded(patternproof.expectationRelatedReworkRate - baseline.expectationRelatedReworkRate),
    },
    caveat: "Descriptive pilot output only. It does not establish causality, prevalence, statistical significance, or prevented remakes.",
  };
}
