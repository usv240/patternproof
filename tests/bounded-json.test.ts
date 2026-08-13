import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  readBoundedJsonBody,
  RequestBodyTooLargeError,
} from "../lib/security/bounded-json";

function bodySource(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
  onCancel?: () => void,
) {
  return {
    headers: new Headers(headers),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        if (!onCancel) controller.close();
      },
      cancel() {
        onCancel?.();
      },
    }),
  };
}

test("bounded JSON reader accepts a body exactly at the byte limit", async () => {
  const bytes = new TextEncoder().encode('{"ok":true}');
  const value = await readBoundedJsonBody(bodySource([bytes]), bytes.byteLength);
  assert.deepEqual(value, { ok: true });
});

test("bounded JSON reader rejects an oversized declared length before reading", async () => {
  await assert.rejects(
    readBoundedJsonBody(
      bodySource([new TextEncoder().encode("{}")], { "content-length": "11" }),
      10,
    ),
    RequestBodyTooLargeError,
  );
});

test("bounded JSON reader cancels a chunked body once it crosses the limit", async () => {
  let cancelled = false;
  await assert.rejects(
    readBoundedJsonBody(
      bodySource(
        [new Uint8Array(6), new Uint8Array(5)],
        {},
        () => { cancelled = true; },
      ),
      10,
    ),
    RequestBodyTooLargeError,
  );
  assert.equal(cancelled, true);
});

test("bounded JSON reader rejects a body that lies about Content-Length", async () => {
  const bytes = new TextEncoder().encode('{"value":"too long"}');
  await assert.rejects(
    readBoundedJsonBody(
      bodySource([bytes], { "content-length": "2" }),
      bytes.byteLength - 1,
    ),
    RequestBodyTooLargeError,
  );
});

test("bounded JSON reader rejects malformed JSON and invalid lengths", async () => {
  await assert.rejects(
    readBoundedJsonBody(bodySource([new TextEncoder().encode("{")]), 10),
    SyntaxError,
  );
  await assert.rejects(
    readBoundedJsonBody(bodySource([], { "content-length": "nope" }), 10),
    RequestBodyTooLargeError,
  );
});

const boundedJsonRoutes = [
  "../app/api/auth/magic-link/route.ts",
  "../app/api/youcam/render/route.ts",
  "../app/api/share/[token]/approve/route.ts",
  "../app/api/brief/[briefId]/withdraw-review/route.ts",
  "../app/api/brief/[briefId]/requirements/route.ts",
  "../app/api/brief/[briefId]/requirements/[requirementId]/route.ts",
  "../app/api/brief/intake/session/route.ts",
  "../app/api/brief/intake/finalize/route.ts",
];

test("all JSON mutation routes use the bounded reader", () => {
  for (const route of boundedJsonRoutes) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    assert.match(source, /readBoundedJsonBody\(request, MAX_BODY_BYTES\)/, route);
    assert.doesNotMatch(source, /request\.(?:json|text)\(\)/, route);
  }
});
