import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { hashPassword } from "../lib/passwords.ts";

// Requires a running local server. All temporary auth data is removed afterward.
const origin = process.env.AUTH_TEST_URL ?? "http://localhost:3002";
const username = "auth_test_" + randomBytes(8).toString("hex");
const password = randomBytes(24).toString("hex");
const workspaceId = process.env.MONGODB_WORKSPACE_ID ?? "default";
const client = await new MongoClient(process.env.MONGODB_URI).connect();
const db = client.db(process.env.MONGODB_DB ?? "regals_ror2_mods");
let userId;
try {
  userId = (await db.collection("users").insertOne({ username, workspaceId, passwordHash: await hashPassword(password), disabled: false })).insertedId;
  const anonymous = await fetch(origin + "/", { redirect: "manual" });
  assert.equal(anonymous.status, 307);
  assert.ok(anonymous.headers.get("location").includes("/login"));
  assert.equal((await fetch(origin + "/login")).status, 200);
  for (const path of ["/api/workspace", "/api/mod-reviews", "/api/mod-configs?packId=hc-eclipse-climb"]) {
    assert.equal((await fetch(origin + path)).status, 401);
    assert.equal((await fetch(origin + path, { headers: { cookie: "regals_session=" + "0".repeat(64) } })).status, 401);
  }
  const login = (credentials, extra = {}) => fetch(origin + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...extra }, body: JSON.stringify(credentials) });
  assert.equal((await login({ username, password: "incorrect" })).status, 401);
  assert.equal((await login({ username, password }, { Origin: "https://untrusted.example" })).status, 403);
  const response = await login({ username, password });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie.includes("HttpOnly"));
  assert.ok(setCookie.includes("SameSite=lax"));
  const cookie = setCookie.split(";")[0];
  const headers = { cookie, Origin: origin };
  assert.equal((await fetch(origin + "/", { headers })).status, 200);
  assert.equal((await fetch(origin + "/api/workspace", { headers })).status, 200);
  assert.equal((await fetch(origin + "/api/workspace", { method: "PUT", headers: { cookie, Origin: "https://untrusted.example" } })).status, 403);
  assert.equal((await fetch(origin + "/api/auth/logout", { method: "POST", headers })).status, 200);
  assert.equal((await fetch(origin + "/api/workspace", { headers })).status, 401);
  console.log("Passed login page, redirects, API protection, forged sessions, rejected credentials, origin checks, login cookies, authenticated access, and logout revocation.");
} finally {
  if (userId) {
    await db.collection("auth_sessions").deleteMany({ userId, workspaceId });
    await db.collection("users").deleteOne({ _id: userId, workspaceId });
  }
  await db.collection("auth_login_attempts").deleteMany({ username, workspaceId });
  await client.close();
}
