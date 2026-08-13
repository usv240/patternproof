const HOSTNAME = /^(?:\*\.)?(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EXPECTED_BUCKET_BYTES = 10 * 1024 * 1024;
export const EXPECTED_BUCKET_MIMES = ["image/jpeg", "image/png"] as const;

type ImageBucketConfiguration = {
  public?: unknown;
  file_size_limit?: unknown;
  allowed_mime_types?: unknown;
};

export function hasValidYouCamResultHosts(value: string | undefined): boolean {
  const hosts = (value ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return hosts.length > 0 && hosts.every((host) => HOSTNAME.test(host));
}

export function hasValidPrivacyContact(value: string | undefined): boolean {
  return EMAIL.test(value?.trim() ?? "");
}
export function hasExpectedPrivateImageBucket(
  value: ImageBucketConfiguration,
): boolean {
  const mimeTypes = value.allowed_mime_types;
  return value.public === false &&
    value.file_size_limit === EXPECTED_BUCKET_BYTES &&
    Array.isArray(mimeTypes) &&
    mimeTypes.length === EXPECTED_BUCKET_MIMES.length &&
    new Set(mimeTypes).size === EXPECTED_BUCKET_MIMES.length &&
    EXPECTED_BUCKET_MIMES.every((mime) => mimeTypes.includes(mime));
}
