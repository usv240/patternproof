export class ResponseBodyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseBodyLimitError";
  }
}
export async function cancelResponseBody(
  response: Pick<Response, "body">,
): Promise<void> {
  if (!response.body) return;
  await response.body
    .cancel("Response body is no longer needed.")
    .catch(() => undefined);
}

export async function readBoundedResponseBlob(
  response: Response,
  maxBytes: number,
): Promise<Blob> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("A positive response byte limit is required.");
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const normalized = contentLength.trim();
    const declared = Number(normalized);
    if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(declared)) {
      await cancelResponseBody(response);
      throw new ResponseBodyLimitError("Response Content-Length is invalid.");
    }
    if (declared > maxBytes) {
      await cancelResponseBody(response);
      throw new ResponseBodyLimitError("Response exceeded size limit.");
    }
  }

  if (!response.body) {
    return new Blob([], { type: response.headers.get("content-type") ?? "" });
  }

  const reader = response.body.getReader();
  const parts: ArrayBuffer[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel("Response exceeded size limit.").catch(() => undefined);
        throw new ResponseBodyLimitError("Response exceeded size limit.");
      }
      const part = new Uint8Array(value.byteLength);
      part.set(value);
      parts.push(part.buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(parts, { type: response.headers.get("content-type") ?? "" });
}
