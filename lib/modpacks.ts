import type { Db } from "mongodb";

export type Pack = {
  id: string;
  name: string;
  color: string;
  notes: string;
  modIds: string[];
  curatedVersions?: Record<string, string>;
};

export type ModpackDocument = Pack & {
  workspaceId: string;
  position: number;
  options: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
};

// Retain the embedded legacy packs as a recovery source. Only migrate once;
// otherwise a removed pack could be restored on the next read.
export async function migrateModpacks(db: Db, workspaceId: string) {
  const packs = db.collection<ModpackDocument>("modpacks");
  await packs.createIndex({ workspaceId: 1, id: 1 }, { unique: true });
  const workspace = await db.collection("workspaces").findOne({ workspaceId });
  if (!workspace || workspace.modpacksSchemaVersion === 2) return;

  const legacy: Pack[] = workspace.packs ?? [];
  if (!Array.isArray(legacy) || legacy.some((pack) =>
    !pack || typeof pack.id !== "string" || !pack.id ||
    typeof pack.name !== "string" || typeof pack.color !== "string" ||
    !Array.isArray(pack.modIds) || pack.modIds.some((id) => typeof id !== "string")
  )) throw new Error("Legacy modpack data is invalid; migration stopped without changing it");
  if (new Set(legacy.map((pack) => pack.id)).size !== legacy.length) {
    throw new Error("Legacy modpack IDs are duplicated; migration stopped");
  }

  await db.collection("workspace_migration_backups").updateOne(
    { workspaceId, migration: "separate-modpacks-v2" },
    { $setOnInsert: { workspaceId, migration: "separate-modpacks-v2", workspace, createdAt: new Date() } },
    { upsert: true },
  );
  const now = new Date();
  for (const [position, pack] of legacy.entries()) {
    await packs.updateOne({ workspaceId, id: pack.id }, {
      $setOnInsert: { ...pack, notes: pack.notes ?? "", workspaceId, position, options: {}, createdAt: now, updatedAt: now },
    }, { upsert: true });
  }
  await db.collection("workspaces").updateOne({ workspaceId }, {
    $set: { modpacksSchemaVersion: 2, modpacksMigratedAt: now },
  });
}

export async function readModpacks(db: Db, workspaceId: string) {
  await migrateModpacks(db, workspaceId);
  return db.collection<ModpackDocument>("modpacks")
    .find({ workspaceId, deletedAt: { $exists: false } }, { projection: { _id: 0 } })
    .sort({ position: 1, id: 1 }).toArray();
}

export async function saveModpacks(db: Db, workspaceId: string, packs: Pack[]) {
  await migrateModpacks(db, workspaceId);
  const collection = db.collection<ModpackDocument>("modpacks");
  const now = new Date();
  for (const [position, pack] of packs.entries()) {
    await collection.updateOne({ workspaceId, id: pack.id }, {
      $set: { ...pack, workspaceId, position, updatedAt: now },
      $setOnInsert: { options: {}, createdAt: now },
      $unset: { deletedAt: "" },
    }, { upsert: true });
  }
  // Keep removed objects recoverable, including future per-pack options.
  await collection.updateMany({ workspaceId, id: { $nin: packs.map((pack) => pack.id) }, deletedAt: { $exists: false } }, {
    $set: { deletedAt: now, updatedAt: now },
  });
}
