import { sameOrigin, createSession } from "@/lib/auth";
import { getDb, getWorkspaceId } from "@/lib/mongodb";
import { verifyPassword } from "@/lib/passwords";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  let username: string, password: string;
  try {
    const body = await request.json();
    if (typeof body.username !== "string" || typeof body.password !== "string" || body.password.length > 1024 || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.username)) throw new Error();
    username = body.username.toLowerCase(); password = body.password;
  } catch { return Response.json({ error: "Invalid username or password" }, { status: 400 }); }
  try {
    const db = await getDb();
    const attempts = db.collection("auth_login_attempts");
    await attempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await attempts.createIndex({ workspaceId: 1, username: 1, window: 1 }, { unique: true });
    const window = Math.floor(Date.now() / (15 * 60 * 1000));
    const filter = { workspaceId: getWorkspaceId(), username, window };
    const attempt = await attempts.findOneAndUpdate(filter, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * 15 * 60 * 1000) } }, { upsert: true, returnDocument: "after" });
    if ((attempt?.count ?? 0) > 10) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
    const user = await db.collection("users").findOne({ workspaceId: getWorkspaceId(), username, disabled: { $ne: true } });
    // Perform the same password work even for unknown accounts.
    const dummy = "scrypt$" + "0".repeat(32) + "$" + "0".repeat(128);
    const valid = await verifyPassword(password, user?.passwordHash ?? dummy);
    if (!user || !valid) return Response.json({ error: "Invalid username or password" }, { status: 401 });
    await createSession(user._id);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Login is unavailable. Please try again." }, { status: 503 }); }
}
