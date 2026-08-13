import { createHash } from "node:crypto";

import { isPlausibleShareToken } from "./security/share-token-core";
import { isPublicDemoToken } from "./public-demo-token";

export const PUBLIC_DEMO_REFERENCE_SHA256 =
  "bdac93a07a670da973fed37e648d54474410f37778334c0516599492a2070a00";
export const PUBLIC_DEMO_RENDER_SHA256 =
  "b53062e7e436dbd96379a9f12d23972c8108c3f454e72ff03dd2483245ef43e9";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    const objectValue = value as unknown as Record<string, unknown>;
    for (const child of Object.values(objectValue)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const frozenRecord = deepFreeze({
  schema_version: "patternproof-public-demo-v1",
  shop: {
    name: "PatternProof Sample Studio",
  },
  brief: {
    customer_label: "Fictional example - no customer data",
  },
  revision: {
    version: 1,
    category: "dress",
    created_at: "2026-08-03T00:00:00.000Z",
    reference_sha256: PUBLIC_DEMO_REFERENCE_SHA256,
    render_sha256: PUBLIC_DEMO_RENDER_SHA256,
  },
  requirements: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      label: "Preserve the olive wrap silhouette",
      note: "Keep the diagonal front and softly pleated A-line skirt.",
      feasibility: { status: "as_shown", tailor_note: null },
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      label: "Cream piping around the neckline and front edge",
      note: "The contrast trim is a defining visual detail.",
      feasibility: {
        status: "with_adjustment",
        tailor_note: "Use pre-shrunk contrast binding so the curved edge stays flat.",
      },
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      label: "Elbow sleeves and two cream waist buttons",
      note: null,
      feasibility: { status: "as_shown", tailor_note: null },
    },
  ],
  annotations: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      requirement_id: "10000000-0000-4000-8000-000000000003",
      author_role: "sample tailor",
      anchor_x: 0.51,
      anchor_y: 0.39,
      body: "Keep the contrast buttons aligned with the wrap closure.",
      created_at: "2026-08-03T00:05:00.000Z",
    },
  ],
  consent: {
    scope: "Synthetic public demonstration only; no customer image or customer record.",
    rights_confirmed: true as const,
    body_processing_confirmed: true as const,
    policy_version: "public-demo-v1",
    granted_at: "2026-08-03T00:00:00.000Z",
  },
} as const);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(",")}}`;
}

export function computePublicDemoProof(): string {
  return createHash("sha256").update(canonicalJson(frozenRecord), "utf8").digest("hex");
}

export const PUBLIC_DEMO_SNAPSHOT_SHA256 = computePublicDemoProof();

export const PUBLIC_DEMO_PAYLOAD = deepFreeze({
  mode: "public_demo" as const,
  immutable: true as const,
  brief: {
    id: "30000000-0000-4000-8000-000000000001",
    shop_name: frozenRecord.shop.name,
    customer_label: frozenRecord.brief.customer_label,
    status: "public_demo",
    token_expires_at: "9999-12-31T23:59:59.999Z",
    approved_revision_id: null,
    snapshot_sha256: PUBLIC_DEMO_SNAPSHOT_SHA256,
  },
  revision: {
    id: "40000000-0000-4000-8000-000000000001",
    version: frozenRecord.revision.version,
    category: frozenRecord.revision.category,
    created_at: frozenRecord.revision.created_at,
    reference_sha256: frozenRecord.revision.reference_sha256,
    render_sha256: frozenRecord.revision.render_sha256,
    locked: true,
    referenceUrl: "/demo/reference-olive.jpg",
    renderUrl: "/demo/render-olive.jpg",
    requirements: frozenRecord.requirements,
    annotations: frozenRecord.annotations,
  },
  consent: frozenRecord.consent,
});

export type ShareReadDisposition =
  | "public_demo"
  | "invalid_token"
  | "sharing_unconfigured"
  | "private_share";

export function classifyShareReadRequest(
  token: unknown,
  privateSharingConfigured: boolean,
): ShareReadDisposition {
  if (isPublicDemoToken(token)) return "public_demo";
  if (typeof token !== "string" || !isPlausibleShareToken(token)) return "invalid_token";
  if (!privateSharingConfigured) return "sharing_unconfigured";
  return "private_share";
}
