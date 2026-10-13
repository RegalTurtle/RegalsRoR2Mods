import { canSeePack } from "@/lib/access";
import { guardApi, getUser } from "@/lib/auth";
import { getDb, getWorkspaceId } from "@/lib/mongodb";
import { configPath, versionParts } from "@/lib/profile-export";

import { loadModpackConfigs } from "@/lib/modpack-configs";

export const dynamic = "force-dynamic";

// Add membership and its source config together in the destination document.
export async function PATCH(request: Request) {
  const denied = await guardApi(request, false, true);
  if (denied) return denied;
  let body: { sourcePackId: string; targetPackId: string; modId: string };
  try {
    body = await request.json();
    if (!body || typeof body.sourcePackId !== "string" || !body.sourcePackId ||
      typeof body.targetPackId !== "string" || !body.targetPackId || body.sourcePackId === body.targetPackId ||
      typeof body.modId !== "string" || !/^[A-Za-z0-9_]+-[A-Za-z0-9_]+$/.test(body.modId)) throw new Error("Invalid modpack addition");
  } catch { return Response.json({ error: "Invalid modpack addition" }, { status: 400 }); }
  try {
    const user = (await getUser())!;
    if ([body.sourcePackId, body.targetPackId].some((id) => !canSeePack(user, id))) return Response.json({ error: "Modpack access denied" }, { status: 403 });
    const db = await getDb();
    const workspaceId = getWorkspaceId();
    const collection = db.collection("modpacks");
    const source = await collection.findOne({ workspaceId, id: body.sourcePackId, modIds: body.modId, deletedAt: { $exists: false } });
    if (!source) return Response.json({ error: "Source modpack does not contain this mod" }, { status: 400 });
    const configs = await loadModpackConfigs(db, workspaceId, body.sourcePackId);
    if (!await loadModpackConfigs(db, workspaceId, body.targetPackId)) return Response.json({ error: "Destination modpack not found" }, { status: 404 });
    const config = configs?.[body.modId];
    const now = new Date();
    const result = await collection.updateOne({ workspaceId, id: body.targetPackId, deletedAt: { $exists: false }, modIds: { $ne: body.modId } }, {
      $addToSet: { modIds: body.modId },
      $set: { updatedAt: now, ...(config ? { ["configs." + body.modId]: { ...config, updatedAt: now } } : {}) },
    });
    return Response.json({ added: result.matchedCount > 0, configCopied: Boolean(result.matchedCount && config) });
  } catch { return Response.json({ error: "Unable to add mod and copy its config" }, { status: 503 }); }
}

export async function GET(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const packId = url.searchParams.get("packId") ?? "";
    const modId = url.searchParams.get("modId");
    const db = await getDb();
    if (!packId) return Response.json({ error: "Choose a modpack to configure its mods" }, { status: 400 });
    const user = (await getUser())!;
    if (!canSeePack(user, packId)) return Response.json({ error: "Modpack access denied" }, { status: 403 });
    const configs = await loadModpackConfigs(db, getWorkspaceId(), packId);
    if (!configs) return Response.json({ error: "Modpack not found" }, { status: 404 });
    const targets = modId ? await db.collection("modpacks").find({ workspaceId: getWorkspaceId(),
      id: { $ne: packId }, modIds: modId, deletedAt: { $exists: false } }, { projection: { _id: 0, id: 1, name: 1 } }).sort({ position: 1 }).toArray() : [];
    const visibleTargets = targets.filter((target) => canSeePack(user, target.id));
    const sources = [];
    if (modId) for (const target of visibleTargets) {
      const saved = await loadModpackConfigs(db, getWorkspaceId(), target.id);
      if (saved?.[modId]) sources.push({ id: target.id, name: target.name });
    }
    return Response.json({ targets: visibleTargets, sources, configs: Object.values(configs).filter((config) => !modId || config.modId === modId).map(({ originalContent, ...config }) => { void originalContent; return config; }) });
  } catch { return Response.json({ error: "Unable to load mod configs" }, { status: 503 }); }
}

export async function POST(request: Request) {
  const denied = await guardApi(request, false, true);
  if (denied) return denied;
  let body: { packId: string; modId: string; targetIds: string[] };
  try {
    body = await request.json();
    if (typeof body.packId !== "string" || !body.packId || typeof body.modId !== "string" ||
      !/^[A-Za-z0-9_]+-[A-Za-z0-9_]+$/.test(body.modId) || !Array.isArray(body.targetIds) ||
      !body.targetIds.length || body.targetIds.some((id: unknown) => typeof id !== "string" || !id || id === body.packId)) {
      throw new Error("Choose other modpacks to copy to");
    }
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid copy request" }, { status: 400 }); }
  try {
    const user = (await getUser())!;
    if ([body.packId, ...body.targetIds].some((id) => !canSeePack(user, id))) return Response.json({ error: "Modpack access denied" }, { status: 403 });
    const db = await getDb();
    const workspaceId = getWorkspaceId();
    const configs = await loadModpackConfigs(db, workspaceId, body.packId);
    const source = configs?.[body.modId];
    if (!source) return Response.json({ error: "Save a config before copying it" }, { status: 400 });
    const ids = [...new Set<string>(body.targetIds)];
    const filter = { workspaceId, id: { $in: ids }, modIds: body.modId, deletedAt: { $exists: false } };
    const targets = await db.collection("modpacks").find(filter).toArray();
    if (targets.length !== ids.length) return Response.json({ error: "Some selected modpacks no longer contain this mod. Reopen the config panel." }, { status: 400 });
    for (const id of ids) await loadModpackConfigs(db, workspaceId, id);
    const now = new Date();
    const result = await db.collection("modpacks").updateMany(filter, {
      $set: { ["configs." + body.modId]: { ...source, updatedAt: now }, updatedAt: now },
    });
    return Response.json({ copied: result.matchedCount });
  } catch { return Response.json({ error: "Unable to copy config" }, { status: 503 }); }
}

export async function PUT(request: Request) {
  const denied = await guardApi(request, false, true);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
    if (typeof body.modId !== "string" || !/^[A-Za-z0-9_]+-[A-Za-z0-9_]+$/.test(body.modId) ||
      typeof body.packId !== "string" || !body.packId || typeof body.path !== "string" || typeof body.content !== "string" ||
      body.content.length > 1_000_000 || !body.content.trim() ||
      typeof body.sourceVersion !== "string") throw new Error("Invalid config data");
    configPath(body.path);
    versionParts(body.sourceVersion);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid config" }, { status: 400 }); }
  try {
    const user = (await getUser())!;
    if ([body.packId].some((id) => !canSeePack(user, id))) return Response.json({ error: "Modpack access denied" }, { status: 403 });
    const db = await getDb();
    const configs = await loadModpackConfigs(db, getWorkspaceId(), body.packId);
    if (!configs) return Response.json({ error: "Modpack not found" }, { status: 404 });
    const config = { modId: body.modId, path: body.path, sourceVersion: body.sourceVersion,
      supportedVersions: [], appliesToAllVersions: true, content: body.content, updatedAt: new Date(),
      originalContent: configs[body.modId]?.originalContent ?? body.content };
    const result = await db.collection("modpacks").updateOne({ workspaceId: getWorkspaceId(), id: body.packId, deletedAt: { $exists: false } },
      { $set: { ["configs." + body.modId]: config, updatedAt: new Date() } });
    if (!result.matchedCount) return Response.json({ error: "Modpack not found" }, { status: 404 });
    return Response.json({ config });
  } catch { return Response.json({ error: "Unable to save mod config" }, { status: 503 }); }
}
