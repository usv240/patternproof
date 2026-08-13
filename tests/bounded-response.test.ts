import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  readBoundedResponseBlob,
  ResponseBodyLimitError,
} from "../lib/youcam/bounded-response";

test("bounded response reader accepts a body exactly at the byte limit", async () => {
  const response = new Response(new Uint8Array([1, 2, 3, 4]), {
    headers: { "content-type": "image/png" },
  });
  const blob = await readBoundedResponseBlob(response, 4);
  assert.equal(blob.size, 4);
  assert.equal(blob.type, "image/png");
  assert.deepEqual(
    new Uint8Array(await blob.arrayBuffer()),
    new Uint8Array([1, 2, 3, 4]),
  );
});

test("bounded response reader rejects and cancels an oversized declared length", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "content-length": "11" } },
  );
  await assert.rejects(
    readBoundedResponseBlob(response, 10),
    ResponseBodyLimitError,
  );
  assert.equal(cancelled, true);
});

test("bounded response reader cancels a body with no Content-Length at the limit", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(
    readBoundedResponseBlob(response, 10),
    ResponseBodyLimitError,
  );
  assert.equal(cancelled, true);
});

test("bounded response reader rejects a body that lies about Content-Length", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(7));
        controller.enqueue(new Uint8Array(7));
        controller.close();
      },
    }),
    { headers: { "content-length": "3" } },
  );
  await assert.rejects(
    readBoundedResponseBlob(response, 10),
    ResponseBodyLimitError,
  );
});

test("vendor rehosting uses the streaming limit instead of buffering response.blob", () => {
  const source = readFileSync(
    new URL("../lib/youcam/rehost.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /readBoundedResponseBlob\(response, MAX_RESULT_BYTES\)/);
  assert.doesNotMatch(source, /response\.blob\(\)/);
  assert.equal(source.match(/await cancelResponseBody\(response\);/g)?.length, 3);
});
