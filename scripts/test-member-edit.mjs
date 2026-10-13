import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { hashPassword } from "../lib/passwords.ts";
const origin = process.env.AUTH_TEST_URL ?? "http://localhost:3002";
const id = "edit_test_" + randomBytes(8).toString("hex");
const password = randomBytes(20).toString("hex");
const client = await new MongoClient(process.env.MONGODB_URI).connect();
const db = client.db(process.env.MONGODB_DB ?? "regals_ror2_mods");
const workspaceId = process.env.MONGODB_WORKSPACE_ID ?? "default";
let userId;
try {
  const pack = { id, name: "Test", notes: "original", color: "#123456", modIds: ["Test-Mod"], workspaceId, configSchemaVersion: 1 };
  await db.collection("modpacks").insertMany([pack, { ...pack, id: id + "_hidden" }]);
  userId = (await db.collection("users").insertOne({ username: id, workspaceId, role: "member", packIds: [id], groupIds: [], passwordHash: await hashPassword(password) })).insertedId;
  const login = await fetch(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username: id, password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const send = (path, method, body) => fetch(origin + path, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const snapshot = await db.collection("workspaces").findOne({ workspaceId });
  assert.equal((await send("/api/workspace", "PUT", { packs: [{ ...pack, notes: "edited", modIds: ["Test-Mod", "Test-Another"] }], groups: [], tags: {} })).status, 200);
  assert.equal((await db.collection("modpacks").findOne({ workspaceId, id })).notes, "edited");
  assert.equal((await db.collection("modpacks").findOne({ workspaceId, id: id + "_hidden" })).notes, "original");
  assert.deepEqual((await db.collection("workspaces").findOne({ workspaceId })).groups, snapshot.groups);
  assert.deepEqual((await db.collection("workspaces").findOne({ workspaceId })).tags, snapshot.tags);
  assert.equal((await send("/api/workspace", "PUT", { packs: [{ ...pack, id: id + "_hidden", notes: "hacked" }], groups: [], tags: {} })).status, 403);
  const config = { packId: id, modId: "Test-Mod", path: "test.cfg", sourceVersion: "1.0.0", content: "[Main]\nEnabled = true\n" };
  assert.equal((await send("/api/mod-configs", "PUT", config)).status, 200);
  assert.equal((await db.collection("modpacks").findOne({ workspaceId, id })).configs["Test-Mod"].content, config.content);
  assert.equal((await send("/api/mod-configs", "PUT", { ...config, packId: id + "_hidden" })).status, 403);
  assert.equal((await send("/api/mod-configs", "POST", { packId: id, modId: "Test-Mod", targetIds: [id + "_hidden"] })).status, 403);
  assert.equal((await send("/api/mod-configs", "PATCH", { sourcePackId: id, targetPackId: id + "_hidden", modId: "Test-Mod" })).status, 403);
  assert.equal((await send("/api/workspace", "PUT", { packs: [], groups: [], tags: {} })).status, 200);
  assert.equal(await db.collection("modpacks").countDocuments({ workspaceId, id: { $in: [id, id + "_hidden"] }, deletedAt: { $exists: false } }), 2);
  console.log("Passed member modpack edits, config saves, hidden-pack protection, unchanged collections/tags, and safe filtered snapshots.");
} finally {
  await db.collection("modpacks").deleteMany({ workspaceId, id: { $in: [id, id + "_hidden"] } });
  if (userId) { await db.collection("users").deleteOne({ workspaceId, _id: userId }); await db.collection("auth_sessions").deleteMany({ workspaceId, userId }); }
  await db.collection("auth_login_attempts").deleteMany({ workspaceId, username: id });
  await client.close();
}
