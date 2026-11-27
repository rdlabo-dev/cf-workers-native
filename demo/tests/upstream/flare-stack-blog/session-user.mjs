import { createRequire } from "node:module";
import { join } from "node:path";
import { root } from "./backend.mjs";

export async function seedUser(db) {
  const { hashPassword } = await import(
    createRequire(join(root, "package.json")).resolve("better-auth/crypto")
  );
  await db
    .prepare(
      "INSERT INTO user(id,name,email,email_verified,updated_at) VALUES ('reader','Reader','reader@example.com',1,0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO account(id,account_id,provider_id,user_id,password,updated_at) VALUES ('credential','reader','credential','reader',?,0)",
    )
    .bind(await hashPassword("local-fixture-password"))
    .run();
}
