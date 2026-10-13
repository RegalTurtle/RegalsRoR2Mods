import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { hashPassword } from "../lib/passwords.ts";

const origin = process.env.AUTH_TEST_URL ?? "http://localhost:3002";
const prefix = "account_test_" + randomBytes(6).toString("hex");
const oldPassword = randomBytes(20).toString("hex"), newPassword = randomBytes(20).toString("hex");
const client = await new MongoClient(process.env.MONGODB_URI).connect();
const db = client.db(process.env.MONGODB_DB ?? "regals_ror2_mods");
const workspaceId = process.env.MONGODB_WORKSPACE_ID ?? "default";
const ids = [];
const names = [];
async function login(username, password) {
  const response = await fetch(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
const update = (cookie, body, requestOrigin = origin) => fetch(origin + "/api/account", { method: "PATCH", headers: { cookie, Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
try {
  assert.equal((await update("", {})).status, 401);
  for (const role of ["member", "admin"]) {
    const username = prefix + "_" + role, renamed = username + "_new";
    names.push(username, renamed);
    const id = (await db.collection("users").insertOne({ workspaceId, username, role, passwordHash: await hashPassword(oldPassword), packIds: [], groupIds: [] })).insertedId;
    ids.push(id);
    const first = await login(username, oldPassword); assert.equal(first.response.status, 200);
    const second = await login(username, oldPassword); assert.equal(second.response.status, 200);
    assert.equal((await fetch(origin + "/account", { headers: { cookie: first.cookie } })).status, 200);
    const body = { username: renamed, currentPassword: oldPassword, newPassword: "" };
    assert.equal((await update(first.cookie, { ...body, currentPassword: "wrong" })).status, 400);
    assert.equal((await update(first.cookie, body, "https://untrusted.example")).status, 403);
    assert.equal((await update(first.cookie, { ...body, role: role === "admin" ? "member" : "admin" })).status, 200);
    assert.equal((await db.collection("users").findOne({ _id: id })).role, role);
    assert.equal((await login(username, oldPassword)).response.status, 401);
    const changed = await update(first.cookie, { ...body, newPassword }); assert.equal(changed.status, 200);
    const rotatedCookie = changed.headers.get("set-cookie").split(";")[0];
    for (const cookie of [first.cookie, second.cookie]) assert.equal((await fetch(origin + "/api/workspace", { headers: { cookie } })).status, 401);
    assert.equal((await fetch(origin + "/api/workspace", { headers: { cookie: rotatedCookie } })).status, 200);
    assert.equal((await login(renamed, oldPassword)).response.status, 401);
    assert.equal((await login(renamed, newPassword)).response.status, 200);
  }
  console.log("Passed self-service username/password changes for members and admins, current-password validation, origin checks, role preservation, cookie rotation, other-session revocation, and updated credentials.");
} finally {
  await db.collection("auth_sessions").deleteMany({ workspaceId, userId: { $in: ids } });
  await db.collection("auth_account_attempts").deleteMany({ workspaceId, userId: { $in: ids } });
  await db.collection("users").deleteMany({ workspaceId, _id: { $in: ids } });
  await db.collection("auth_login_attempts").deleteMany({ workspaceId, username: { $in: names } });
  await client.close();
}
