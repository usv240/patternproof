export class RequestBodyTooLargeError extends RangeError {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

type RequestBodySource = {
  body: ReadableStream<Uint8Array<ArrayBufferLike>> | null;
  headers: Headers;
};

async function cancelQuietly(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (!body) return;
  await body.cancel("Request body is too large.").catch(() => undefined);
}

export async function readBoundedJsonBody(
  request: RequestBodySource,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("A positive request byte limit is required.");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const normalized = contentLength.trim();
    const declared = Number(normalized);
    if (
      !/^\d+$/.test(normalized) ||
      !Number.isSafeInteger(declared) ||
      declared > maxBytes
    ) {
      await cancelQuietly(request.body);
      throw new RequestBodyTooLargeError();
    }
  }

  if (!request.body) return JSON.parse("") as unknown;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel("Request body is too large.").catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(raw) as unknown;
}
