import { ObjectId } from "mongodb";
import { guardApi, getUser } from "@/lib/auth";
import { accountAccess } from "@/lib/access";
import { getDb, getWorkspaceId } from "@/lib/mongodb";
import { hashPassword } from "@/lib/passwords";

export async function GET(request: Request) {
  const denied = await guardApi(request, true); if (denied) return denied;
  try {
    const db = await getDb(); const workspaceId = getWorkspaceId();
    const users = await db.collection("users").find({ workspaceId }, { projection: { passwordHash: 0 } }).sort({ username: 1 }).toArray();
    const packs = await db.collection("modpacks").find({ workspaceId, deletedAt: { $exists: false } }, { projection: { _id: 0, id: 1, name: 1 } }).sort({ position: 1 }).toArray();
    const workspace = await db.collection("workspaces").findOne({ workspaceId }, { projection: { groups: 1 } });
    return Response.json({ users: users.map((user) => ({ id: user._id.toString(), username: user.username, ...accountAccess(user) })),
      packs, groups: (workspace?.groups ?? []).map((group: { id: string; name: string }) => ({ id: group.id, name: group.name })), currentUserId: (await getUser())?.id });
  } catch { return Response.json({ error: "Unable to load accounts" }, { status: 503 }); }
}

async function payload(request: Request) {
  const body = await request.json();
  if (!body || !["packIds", "groupIds"].every((key) => Array.isArray(body[key]) && body[key].every((id: unknown) => typeof id === "string")) ||
    typeof body.allPacks !== "boolean" || typeof body.allGroups !== "boolean") throw new Error("Invalid account permissions");
  const db = await getDb(); const workspaceId = getWorkspaceId();
  const packs = await db.collection("modpacks").find({ workspaceId, deletedAt: { $exists: false } }, { projection: { id: 1 } }).toArray();
  const workspace = await db.collection("workspaces").findOne({ workspaceId });
  if (body.packIds.some((id: string) => !packs.some((pack) => pack.id === id)) || body.groupIds.some((id: string) => !workspace?.groups?.some((group: { id: string }) => group.id === id))) throw new Error("Unknown modpack or collection");
  return { body, db, workspaceId, access: { allPacks: body.allPacks, allGroups: body.allGroups, packIds: [...new Set<string>(body.packIds)], groupIds: [...new Set<string>(body.groupIds)] } };
}

export async function POST(request: Request) {
  const denied = await guardApi(request, true); if (denied) return denied;
  try {
    const { body, db, workspaceId, access } = await payload(request);
    if (typeof body.username !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.username) || typeof body.password !== "string" || body.password.length < 12 || body.password.length > 1024) return Response.json({ error: "Use a valid username and a password of at least 12 characters" }, { status: 400 });
    const users = db.collection("users"); await users.createIndex({ workspaceId: 1, username: 1 }, { unique: true });
    await users.insertOne({ workspaceId, username: body.username.toLowerCase(), passwordHash: await hashPassword(body.password), role: "member", ...access, disabled: false, createdAt: new Date() });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return Response.json({ error: "Username already exists" }, { status: 409 });
    return Response.json({ error: "Unable to create account. Check the selected permissions." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const denied = await guardApi(request, true); if (denied) return denied;
  try {
    const { body, db, workspaceId, access } = await payload(request);
    if (typeof body.id !== "string" || !ObjectId.isValid(body.id)) return Response.json({ error: "Invalid account" }, { status: 400 });
    const result = await db.collection("users").updateOne({ _id: new ObjectId(body.id), workspaceId, role: { $ne: "admin" } }, { $set: { ...access, updatedAt: new Date() } });
    return result.matchedCount ? Response.json({ ok: true }) : Response.json({ error: "Account not found or is an administrator" }, { status: 400 });
  } catch { return Response.json({ error: "Unable to update permissions" }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  const denied = await guardApi(request, true); if (denied) return denied;
  try {
    const body = await request.json();
    if (typeof body.id !== "string" || !ObjectId.isValid(body.id)) return Response.json({ error: "Invalid account" }, { status: 400 });
    const db = await getDb(); const workspaceId = getWorkspaceId(); const userId = new ObjectId(body.id);
    const result = await db.collection("users").deleteOne({ _id: userId, workspaceId, role: { $ne: "admin" } });
    if (!result.deletedCount) return Response.json({ error: "Account not found or is an administrator" }, { status: 400 });
    await db.collection("auth_sessions").deleteMany({ userId, workspaceId });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Unable to delete account" }, { status: 503 }); }
}
