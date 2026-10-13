import { cookies } from "next/headers";
import { SESSION_COOKIE, sameOrigin, tokenHash } from "@/lib/auth";
import { getDb, getWorkspaceId } from "@/lib/mongodb";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  try {
    if (token) await (await getDb()).collection("auth_sessions").deleteOne({ tokenHash: tokenHash(token), workspaceId: getWorkspaceId() });
    store.delete(SESSION_COOKIE);
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Unable to log out. Try again." }, { status: 503 }); }
}
