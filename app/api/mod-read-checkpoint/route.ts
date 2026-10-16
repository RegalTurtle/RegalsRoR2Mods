import { ObjectId } from "mongodb";
import { guardApi, getUser } from "@/lib/auth";
import { getDb, getWorkspaceId } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  try {
    const user = (await getUser())!;
    const db = await getDb();
    const account = await db.collection("users").findOne(
      { _id: new ObjectId(user.id), workspaceId: getWorkspaceId() },
      { projection: { modsReadThrough: 1 } },
    );
    return Response.json({ readThrough: account?.modsReadThrough ?? null });
  } catch {
    return Response.json({ error: "Unable to load read checkpoint" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const denied = await guardApi(request, false, true);
  if (denied) return denied;
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid checkpoint" }, { status: 400 }); }
  if (!Number.isSafeInteger(body?.readThrough) || body.readThrough < 0 || body.readThrough > Date.now()) {
    return Response.json({ error: "Invalid checkpoint" }, { status: 400 });
  }
  try {
    const user = (await getUser())!;
    const db = await getDb();
    // Concurrent devices may advance the checkpoint, but cannot move it backwards.
    const account = await db.collection("users").findOneAndUpdate(
      { _id: new ObjectId(user.id), workspaceId: getWorkspaceId() },
      { $max: { modsReadThrough: body.readThrough } },
      { returnDocument: "after", projection: { modsReadThrough: 1 } },
    );
    if (!account) return Response.json({ error: "Account unavailable" }, { status: 404 });
    return Response.json({ readThrough: account.modsReadThrough });
  } catch {
    return Response.json({ error: "Unable to save read checkpoint" }, { status: 503 });
  }
}
