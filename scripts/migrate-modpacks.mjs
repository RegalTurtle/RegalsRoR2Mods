import { MongoClient } from "mongodb";
import { migrateModpacks, readModpacks } from "../lib/modpacks.ts";

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? "regals_ror2_mods");
  const workspaceId = process.env.MONGODB_WORKSPACE_ID ?? "default";
  const workspace = await db.collection("workspaces").findOne({ workspaceId });
  const legacyCount = workspace?.packs?.length ?? 0;
  await migrateModpacks(db, workspaceId);
  const packs = await readModpacks(db, workspaceId);
  console.log(JSON.stringify({ workspaceId, legacyCount, modpackCount: packs.length,
    backup: "workspace_migration_backups", packs: packs.map(({ id, name, modIds }) => ({ id, name, modCount: modIds.length })) }, null, 2));
} finally {
  await client.close();
}
