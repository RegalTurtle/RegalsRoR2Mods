import fs from "node:fs";
import { MongoClient } from "mongodb";
import { readModpacks, saveModpacks } from "../lib/modpacks.ts";

const file = process.argv[2];
if (!file) throw new Error("Usage: node --env-file=.env scripts/import-workspace.mjs <workspace.json>");
const source = JSON.parse(fs.readFileSync(file, "utf8"));
const validCollection = (item) => item && typeof item.id === "string" && item.id &&
  typeof item.name === "string" && typeof item.color === "string" &&
  Array.isArray(item.modIds) && item.modIds.every((id) => typeof id === "string");
if (!Array.isArray(source.packs) || !source.packs.every(validCollection) ||
    !Array.isArray(source.groups) || !source.groups.every(validCollection) ||
    !source.tags || typeof source.tags !== "object" || Array.isArray(source.tags) ||
    !Object.values(source.tags).every((tags) => Array.isArray(tags) && tags.every((tag) => typeof tag === "string")) ||
    new Set(source.packs.map((pack) => pack.id)).size !== source.packs.length) {
  throw new Error("Invalid recovery workspace; no changes made");
}
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? "regals_ror2_mods");
  const workspaceId = process.env.MONGODB_WORKSPACE_ID ?? "default";
  const existing = await db.collection("workspaces").findOne({ workspaceId });
  await db.collection("workspace_recovery_backups").insertOne({ workspaceId, sourceFile: file,
    previousWorkspace: existing, importedWorkspace: source, createdAt: new Date() });
  const existingPacks = await readModpacks(db, workspaceId);
  const packs = new Map(existingPacks.map((pack) => [pack.id, pack]));
  for (const pack of source.packs) {
    const previous = packs.get(pack.id);
    packs.set(pack.id, previous ? { ...previous, modIds: [...new Set([...previous.modIds, ...pack.modIds])] }
      : { ...pack, notes: pack.notes ?? "" });
  }
  // Only pass editable fields; timestamps and options remain owned by storage.
  await saveModpacks(db, workspaceId, [...packs.values()].map(({ id, name, color, notes, modIds }) => ({ id, name, color, notes, modIds })));
  const groups = new Map((existing?.groups ?? []).map((group) => [group.id, group]));
  for (const group of source.groups) {
    const previous = groups.get(group.id);
    groups.set(group.id, previous ? { ...previous, modIds: [...new Set([...previous.modIds, ...group.modIds])] } : group);
  }
  const tags = { ...existing?.tags };
  for (const [id, values] of Object.entries(source.tags)) tags[id] = [...new Set([...(tags[id] ?? []), ...values])];
  await db.collection("workspaces").updateOne({ workspaceId }, {
    $set: { workspaceId, groups: [...groups.values()], tags, modpacksSchemaVersion: 2, updatedAt: new Date() },
  }, { upsert: true });
  const restored = await readModpacks(db, workspaceId);
  for (const pack of source.packs) {
    const saved = restored.find((item) => item.id === pack.id);
    if (!saved || pack.modIds.some((id) => !saved.modIds.includes(id))) throw new Error(`Verification failed for ${pack.id}`);
  }
  console.log(JSON.stringify({ importedPacks: source.packs.length, savedPacks: restored.length,
    groups: groups.size, taggedMods: Object.keys(tags).length, membershipVerification: "passed" }, null, 2));
} finally { await client.close(); }
