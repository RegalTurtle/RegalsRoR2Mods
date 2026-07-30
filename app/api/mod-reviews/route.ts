import { getDb, getWorkspaceId } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type ModReview = {
  workspaceId: string;
  modId: string;
  rating: number;
  hasPlayed: boolean;
  wantsReplay: boolean | null;
  notes: string;
  updatedAt: Date;
};

function normalizeRating(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function normalizeBody(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  if (typeof body.modId !== "string" || !body.modId) return undefined;

  return {
    modId: body.modId,
    rating: normalizeRating(body.rating),
    hasPlayed: Boolean(body.hasPlayed),
    wantsReplay: typeof body.wantsReplay === "boolean" ? body.wantsReplay : null,
    notes: typeof body.notes === "string" ? body.notes : "",
  };
}

export async function GET() {
  try {
    const db = await getDb();
    const reviews = await db
      .collection<ModReview>("modReviews")
      .find({ workspaceId: getWorkspaceId() }, { projection: { _id: 0, workspaceId: 0 } })
      .toArray();

    return Response.json({
      reviews: Object.fromEntries(reviews.map((review) => [review.modId, review])),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to read mod reviews" },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = normalizeBody(await request.json());
    if (!body) return Response.json({ error: "Invalid review payload" }, { status: 400 });

    const db = await getDb();
    const updatedAt = new Date();

    await db.collection<ModReview>("modReviews").updateOne(
      { workspaceId: getWorkspaceId(), modId: body.modId },
      {
        $set: {
          workspaceId: getWorkspaceId(),
          modId: body.modId,
          rating: body.rating,
          hasPlayed: body.hasPlayed,
          wantsReplay: body.wantsReplay,
          notes: body.notes,
          updatedAt,
        },
      },
      { upsert: true },
    );

    return Response.json({ ok: true, review: { ...body, updatedAt } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save mod review" },
      { status: 503 },
    );
  }
}
