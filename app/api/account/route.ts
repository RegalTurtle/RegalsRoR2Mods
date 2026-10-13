import { ObjectId } from "mongodb";
import { createSession, getUser, sameOrigin } from "@/lib/auth";
import { getDb, getWorkspaceId } from "@/lib/mongodb";
import { hashPassword, verifyPassword } from "@/lib/passwords";

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Login required" }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: "Invalid account details" }, { status: 400 }); }
    if (!body || typeof body.username !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.username) ||
      typeof body.currentPassword !== "string" || !body.currentPassword || body.currentPassword.length > 1024 ||
      typeof body.newPassword !== "string" || (body.newPassword && (body.newPassword.length < 12 || body.newPassword.length > 1024))) {
      return Response.json({ error: "Use a valid username, your current password, and a new password of at least 12 characters" }, { status: 400 });
    }
    const db = await getDb(); const workspaceId = getWorkspaceId(); const userId = new ObjectId(user.id);
    const attempts = db.collection("auth_account_attempts");
    await attempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await attempts.createIndex({ workspaceId: 1, userId: 1, window: 1 }, { unique: true });
    const window = Math.floor(Date.now() / 900000);
    const attempt = await attempts.findOneAndUpdate({ workspaceId, userId, window }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * 900000) } }, { upsert: true, returnDocument: "after" });
    if ((attempt?.count ?? 0) > 10) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
    const users = db.collection("users");
    const account = await users.findOne({ _id: userId, workspaceId, disabled: { $ne: true } });
    if (!account || !await verifyPassword(body.currentPassword, account.passwordHash)) return Response.json({ error: "Current password is incorrect" }, { status: 400 });
    await users.createIndex({ workspaceId: 1, username: 1 }, { unique: true });
    const username = body.username.toLowerCase();
    const result = await users.updateOne({ _id: userId, workspaceId, passwordHash: account.passwordHash }, {
      $set: { username, ...(body.newPassword ? { passwordHash: await hashPassword(body.newPassword) } : {}), updatedAt: new Date() },
    });
    if (!result.matchedCount) return Response.json({ error: "Account changed during this request. Try again." }, { status: 409 });
    if (body.newPassword) {
      await db.collection("auth_sessions").deleteMany({ workspaceId, userId });
      await createSession(userId);
    }
    return Response.json({ username, passwordChanged: Boolean(body.newPassword) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return Response.json({ error: "Username is already taken" }, { status: 409 });
    return Response.json({ error: "Unable to update account. Try again." }, { status: 503 });
  }
}
