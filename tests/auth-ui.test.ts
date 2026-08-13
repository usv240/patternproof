import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local auth accepts the exact PatternProof callback origin", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /site_url = "http:\/\/localhost:3000"/);
  assert.match(config, /"http:\/\/localhost:3000\/auth\/callback"/);
});

test("the landing page visibly distinguishes signed-in and signed-out visitors", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, />Signed in</);
  assert.match(source, />Tailor sign in</);
  assert.match(source, /\/auth\/signout/);
});

test("authenticated pages redirect before rendering private owner controls", async () => {
  const paths = [
    new URL("../app/brief/new/page.tsx", import.meta.url),
    new URL("../app/brief/[briefId]/page.tsx", import.meta.url),
  ];
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    assert.match(source, /supabase\.auth\.getUser\(\)/);
    assert.match(source, /redirect\("\/login\?next=/);
  }
});

test("an authenticated visitor cannot be stranded on the login page", async () => {
  const source = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /redirect\(nextPath\)/);
});
test("browser extensions cannot turn root body attributes into a demo-blocking hydration overlay", async () => {
  const source = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(source, /<body suppressHydrationWarning>/);
});