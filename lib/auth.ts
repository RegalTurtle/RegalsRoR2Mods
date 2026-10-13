import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb, getWorkspaceId } from "./mongodb";
import { accountAccess } from "./access";

export const SESSION_COOKIE = "regals_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function getUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const db = await getDb();
  const session = await db.collection("auth_sessions").findOne({ tokenHash: tokenHash(token), workspaceId: getWorkspaceId(), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const user = await db.collection("users").findOne({ _id: session.userId, workspaceId: getWorkspaceId(), disabled: { $ne: true } });
  return user ? { id: user._id.toString(), username: user.username as string, ...accountAccess(user) } : null;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host); }
  catch { return false; }
}

export async function guardApi(request: Request, adminOnly = false, allowMemberWrites = false) {
  if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Login required" }, { status: 401 });
    if ((adminOnly || (!allowMemberWrites && !["GET", "HEAD"].includes(request.method))) && user.role !== "admin") return Response.json({ error: "Administrator access required" }, { status: 403 });
  } catch { return Response.json({ error: "Authentication unavailable" }, { status: 503 }); }
  return null;
}

export async function createSession(userId: import("mongodb").ObjectId) {
  const db = await getDb();
  await db.collection("auth_sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("auth_sessions").createIndex({ tokenHash: 1 }, { unique: true });
  const token = randomBytes(32).toString("hex");
  const cookieStore = await cookies();
  const previous = cookieStore.get(SESSION_COOKIE)?.value;
  if (previous) await db.collection("auth_sessions").deleteOne({ tokenHash: tokenHash(previous), workspaceId: getWorkspaceId() });
  await db.collection("auth_sessions").insertOne({ tokenHash: tokenHash(token), userId, workspaceId: getWorkspaceId(), expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) });
  cookieStore.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
}
