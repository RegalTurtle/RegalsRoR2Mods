import type { Db } from "mongodb";
import type { ConfigTemplate } from "./profile-export";

export type SavedModConfig = ConfigTemplate & { updatedAt: Date; originalContent: string };

export async function loadModpackConfigs(db: Db, workspaceId: string, packId: string) {
  const collection = db.collection("modpacks");
  let pack = await collection.findOne({ workspaceId, id: packId, deletedAt: { $exists: false } });
  if (!pack) return null;
  if (pack.configSchemaVersion !== 1) {
    const legacy = await db.collection("mod_configs").find({ workspaceId,
      $or: [{ packId }, { packId: "", modId: { $in: pack.modIds ?? [] } }] }).toArray();
    const configs: Record<string, SavedModConfig> = { ...pack.configs };
    // Latest modpack-specific config wins. Keep all legacy documents as backup.
    for (const config of legacy.sort((a, b) => Number(Boolean(a.packId)) - Number(Boolean(b.packId)) ||
      new Date(a.updatedAt ?? 0).getTime() - new Date(b.updatedAt ?? 0).getTime())) {
      configs[config.modId] = { modId: config.modId, path: config.path, content: config.content,
        sourceVersion: config.sourceVersion ?? config.supportedVersions?.join(", ") ?? "Unknown",
        supportedVersions: [], appliesToAllVersions: true, updatedAt: config.updatedAt ?? new Date(),
        originalContent: config.originalContent ?? config.content };
    }
    await collection.updateOne({ _id: pack._id, configSchemaVersion: { $ne: 1 } }, {
      $set: { configs, configSchemaVersion: 1 },
    });
    pack = await collection.findOne({ _id: pack._id });
  }
  return (pack?.configs ?? {}) as Record<string, SavedModConfig>;
}
