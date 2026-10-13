import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { hashPassword } from "../lib/passwords.ts";

const origin = process.env.AUTH_TEST_URL ?? "http://localhost:3002";
const prefix = "access_test_" + randomBytes(6).toString("hex");
const password = randomBytes(20).toString("hex");
const client = await new MongoClient(process.env.MONGODB_URI).connect();
const db = client.db(process.env.MONGODB_DB ?? "regals_ror2_mods");
const workspaceId = process.env.MONGODB_WORKSPACE_ID ?? "default";
let adminId, memberId;
const request = (path, cookie, method = "GET", body) => fetch(origin + path, { method,
  headers: { cookie, Origin: origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function login(username) {
  const response = await request("/api/auth/login", "", "POST", { username, password });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}
try {
  adminId = (await db.collection("users").insertOne({ username: prefix + "_admin", workspaceId, role: "admin", passwordHash: await hashPassword(password) })).insertedId;
  const adminCookie = await login(prefix + "_admin");
  const metadata = await (await request("/api/admin/users", adminCookie)).json();
  assert.ok(metadata.packs.length > 1, "Need at least two modpacks for isolation tests");
  const [allowed, forbidden] = metadata.packs;
  const groupIds = metadata.groups.slice(0, 1).map((group) => group.id);
  const permissions = { allPacks: false, allGroups: false, packIds: [allowed.id], groupIds };
  assert.equal((await request("/api/admin/users", adminCookie, "POST", { username: prefix + "_member", password, ...permissions })).status, 201);
  const member = await db.collection("users").findOne({ username: prefix + "_member", workspaceId });
  memberId = member._id;
  assert.equal(member.passwordHash.startsWith("scrypt$"), true);
  const cookie = await login(prefix + "_member");
  assert.equal((await request("/api/admin/users", cookie)).status, 403);
  assert.equal((await request("/admin/users", cookie)).status, 404);
  let workspace = await (await request("/api/workspace", cookie)).json();
  assert.deepEqual(workspace.packs.map((pack) => pack.id), [allowed.id]);
  assert.deepEqual(workspace.groups.map((group) => group.id), groupIds);
  assert.equal((await request("/modpacks/" + allowed.id, cookie)).status, 200);
  assert.equal((await request("/modpacks/" + forbidden.id, cookie)).status, 404);
  assert.equal((await request("/api/mod-configs?packId=" + forbidden.id, cookie)).status, 403);
  assert.equal((await request("/api/workspace", cookie, "PUT", { packs: [], groups: [], tags: {} })).status, 200);
  assert.equal((await request("/api/mod-configs", cookie, "POST", { packId: forbidden.id, modId: "KingEnderBrine-ProperSave", targetIds: [allowed.id] })).status, 403);
  const listing = await (await request("/api/admin/users", adminCookie)).json();
  assert.ok(listing.users.every((user) => !("passwordHash" in user)));
  assert.equal((await request("/api/admin/users", adminCookie, "DELETE", { id: adminId.toString() })).status, 400);
  assert.equal((await request("/api/admin/users", adminCookie, "PATCH", { id: memberId.toString(), allPacks: false, allGroups: false, packIds: [], groupIds: [] })).status, 200);
  workspace = await (await request("/api/workspace", cookie)).json();
  assert.equal(workspace.packs.length, 0); assert.equal(workspace.groups.length, 0);
  assert.equal((await request("/api/mod-configs?packId=" + allowed.id, cookie)).status, 403);
  assert.equal((await request("/api/admin/users", adminCookie, "DELETE", { id: memberId.toString() })).status, 200);
  assert.equal((await request("/api/workspace", cookie)).status, 401);
  console.log("Passed account creation, hashed passwords, per-pack/collection filtering, direct-route restrictions, config isolation, safe member saves, permission revocation, protected admins, account deletion, and session revocation.");
} finally {
  const ids = [adminId, memberId].filter(Boolean);
  await db.collection("auth_sessions").deleteMany({ workspaceId, userId: { $in: ids } });
  await db.collection("users").deleteMany({ workspaceId, _id: { $in: ids } });
  await db.collection("auth_login_attempts").deleteMany({ workspaceId, username: { $in: [prefix + "_admin", prefix + "_member"] } });
  await client.close();
}
