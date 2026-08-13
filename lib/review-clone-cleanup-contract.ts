import {
  isCanonicalRevisionAssetPath,
  revisionStoragePrefix,
} from "./security/storage-path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ReviewCloneCleanupManifest = {
  bodyPath: string;
  referencePath: string;
  paths: [string, string];
};

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parseReviewCloneCleanupManifest(
  value: unknown,
): ReviewCloneCleanupManifest | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  if (!value.every((path) => typeof path === "string")) return undefined;

  const unique = new Set(value as string[]);
  if (unique.size !== 2) return undefined;

  const bodyPath = (value as string[]).find((path) => path.endsWith("/body.jpg"));
  const referencePath = (value as string[]).find((path) => path.endsWith("/reference.jpg"));
  if (!bodyPath || !referencePath) return undefined;

  const bodyParts = bodyPath.split("/");
  const referenceParts = referencePath.split("/");
  if (bodyParts.length !== 4 || referenceParts.length !== 4) return undefined;
  if (bodyParts.slice(0, 3).some((part) => part !== part.toLowerCase())) {
    return undefined;
  }

  const prefix = revisionStoragePrefix(bodyParts[0], bodyParts[1], bodyParts[2]);
  if (!prefix || referenceParts.slice(0, 3).join("/") !== prefix) return undefined;
  if (!isCanonicalRevisionAssetPath(bodyPath, prefix, "body")) return undefined;
  if (!isCanonicalRevisionAssetPath(referencePath, prefix, "reference")) return undefined;

  return { bodyPath, referencePath, paths: [bodyPath, referencePath] };
}
