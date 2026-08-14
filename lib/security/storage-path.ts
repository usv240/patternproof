const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");

export function revisionStoragePrefix(
  shopId: string,
  briefId: string,
  revisionId: string,
): string | undefined {
  if (!UUID_RE.test(shopId) || !UUID_RE.test(briefId) || !UUID_RE.test(revisionId)) {
    return undefined;
  }
  return `${shopId}/${briefId}/${revisionId}`;
}

export function isCanonicalRevisionAssetPath(
  path: string,
  prefix: string,
  kind: "body" | "reference" | "render",
): boolean {
  if (kind === "body") return path === `${prefix}/body.jpg`;
  if (kind === "reference") return path === `${prefix}/reference.jpg`;
  return new RegExp(`^${prefix}/render-[0-9a-f]{64}\\.jpg$`).test(path);
}


export function isCanonicalFrozenReferencePath(path: string, prefix: string): boolean {
  return path === `${prefix}/reference.jpg`
    || new RegExp(`^${prefix}/reference-clean-[0-9a-f]{64}\\.jpg$`).test(path);
}

export function isCanonicalFrozenRenderPath(path: string, prefix: string): boolean {
  return new RegExp(`^${prefix}/(?:render|fabric)-[0-9a-f]{64}\\.jpg$`).test(path);
}
