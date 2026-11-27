import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeBackend } from "../native/backend.mjs";
import { startWorker } from "../upstream/flare-stack-blog/backend.mjs";
import { seedUser } from "../upstream/flare-stack-blog/session-user.mjs";

const run = promisify(execFile);
const [platform, device] = process.argv.slice(2);
assert.ok(
  ["ios", "android"].includes(platform) && device,
  "Specify ios or android and a booted test device",
);
const here = fileURLToPath(new URL(".", import.meta.url));
let worker, db;
const accounts = [];
const backend = await nativeBackend({
  driver: `const button=document.querySelector('button'); if(button)button.onclick=async()=>{
   button.disabled=true;
   try {
     const login=await fetch('/api/auth/sign-in/email',{method:'POST',mode:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({email:'reader@example.com',password:'local-fixture-password'})});
     if (!login.ok) throw Error('sign-in '+login.status);
     const write=await fetch('/save',{method:'POST',mode:'same-origin'});
     if (!write.ok) throw Error('save '+write.status);
     location.replace('/');
   } catch(error){document.body.textContent=String(error);}
 };`,
  dispose: async () => worker?.dispose(),
  dispatch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path.startsWith("/api/auth/")) return worker.dispatchFetch(url, init);
    if (path !== "/" && path !== "/save")
      return new Response(null, { status: 404 });
    const session = await worker.dispatchFetch(
      new URL("/api/auth/get-session?disableCookieCache=true", url).href,
      { headers: init.headers },
    );
    if (!session.ok) return new Response(null, { status: session.status });
    const user = (await session.json())?.user;
    if (path === "/save") {
      if (init.method !== "POST") return new Response(null, { status: 405 });
      if (user?.id !== "reader") return new Response(null, { status: 401 });
      await db
        .prepare("INSERT INTO recovery_writes (user_id) VALUES (?)")
        .bind(user.id)
        .run();
      return new Response(null, { status: 204 });
    }
    accounts.push(user?.id ?? null);
    let content = "<button>Sign in and save</button>";
    if (user?.id === "reader") {
      const count = await db
        .prepare("SELECT count(*) AS n FROM recovery_writes WHERE user_id=?")
        .bind(user.id)
        .first("n");
      content =
        count === 1
          ? "<h1>Saved for reader@example.com</h1>"
          : "Unexpected write count";
    }
    return new Response(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="padding:48px 16px">' +
        content +
        "</body></html>",
      { headers: { "content-type": "text/html", "cache-control": "no-store" } },
    );
  },
});
const scratch = await mkdtemp(join(tmpdir(), "workers-session-recovery-"));
try {
  ({ worker, db } = await startWorker(backend.url.origin));
  await seedUser(db);
  await db.prepare("CREATE TABLE recovery_writes(user_id TEXT NOT NULL)").run();
  const env = { ...process.env, WORKERS_SESSION_ORIGIN: backend.url.origin };
  if (platform === "android") {
    for (const folder of ["raw", "xml"])
      await mkdir(join(scratch, "res", folder), { recursive: true });
    await copyFile(backend.ca, join(scratch, "res/raw/session_ca.pem"));
    const manifest = await readFile(
      join(here, "android/app/src/debug/AndroidManifest.xml"),
      "utf8",
    );
    await writeFile(
      join(scratch, "AndroidManifest.xml"),
      manifest.replace(
        "<application>",
        '<application android:networkSecurityConfig="@xml/session_trust">',
      ),
    );
    await writeFile(
      join(scratch, "res/xml/session_trust.xml"),
      '<network-security-config><debug-overrides><trust-anchors><certificates src="@raw/session_ca"/></trust-anchors></debug-overrides></network-security-config>',
    );
    env.WORKERS_SESSION_ANDROID_RES = scratch;
  } else {
    await run("xcrun", [
      "simctl",
      "keychain",
      device,
      "add-root-cert",
      backend.ca,
    ]);
  }
  await run(process.execPath, ["run.mjs", device, "session-recovery"], {
    cwd: join(here, platform),
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(accounts[0], null);
  assert.ok(
    accounts.length >= 4 && accounts.slice(1).every((id) => id === "reader"),
    JSON.stringify(accounts),
  );
  assert.deepEqual(
    backend.requests
      .filter((r) => r.method === "POST")
      .map((r) => [r.path, r.status]),
    [
      ["/api/auth/sign-in/email", 200],
      ["/save", 204],
    ],
  );
  assert.equal(
    await db.prepare("SELECT count(*) AS n FROM recovery_writes").first("n"),
    1,
  );
  console.log(
    platform,
    "authenticated reopen and renderer recovery passed",
    JSON.stringify(accounts),
  );
} catch (error) {
  console.error(
    "Recovery requests",
    backend.requests.map(({ method, path, status }) => ({
      method,
      path,
      status,
    })),
  );
  throw error;
} finally {
  await backend.close();
  await rm(scratch, { recursive: true, force: true });
}
