import { getDb, getWorkspaceId } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type Pack = {
  id: string;
  name: string;
  color: string;
  notes: string;
  modIds: string[];
};

type ModGroup = {
  id: string;
  name: string;
  color: string;
  modIds: string[];
};

type Workspace = {
  workspaceId: string;
  packs: Pack[];
  groups: ModGroup[];
  tags: Record<string, string[]>;
  updatedAt: Date;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizePack(value: unknown): Pack | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.color !== "string" ||
    !isStringArray(candidate.modIds)
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    color: candidate.color,
    notes: typeof candidate.notes === "string" ? candidate.notes : "",
    modIds: candidate.modIds,
  };
}

function normalizeGroup(value: unknown): ModGroup | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.color !== "string" ||
    !isStringArray(candidate.modIds)
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    color: candidate.color,
    modIds: candidate.modIds,
  };
}

function normalizeTags(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, tags]) =>
      isStringArray(tags) ? [[key, Array.from(new Set(tags))]] : [],
    ),
  );
}

function normalizeBody(value: unknown) {
  if (!value || typeof value !== "object") {
    return { packs: [], tags: {} };
  }

  const body = value as Record<string, unknown>;
  const packs = Array.isArray(body.packs) ? body.packs.flatMap((pack) => normalizePack(pack) ?? []) : [];
  const groups = Array.isArray(body.groups) ? body.groups.flatMap((group) => normalizeGroup(group) ?? []) : [];

  return {
    packs,
    groups,
    tags: normalizeTags(body.tags),
  };
}

export async function GET() {
  try {
    const db = await getDb();
    const workspace = await db
      .collection<Workspace>("workspaces")
      .findOne(
        { workspaceId: getWorkspaceId() },
        { projection: { _id: 0, packs: 1, groups: 1, tags: 1, updatedAt: 1 } },
      );

    return Response.json({
      exists: Boolean(workspace),
      packs: workspace?.packs ?? [],
      groups: workspace?.groups ?? [],
      tags: workspace?.tags ?? {},
      updatedAt: workspace?.updatedAt ?? null,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to read workspace" },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = normalizeBody(await request.json());
    const db = await getDb();
    const updatedAt = new Date();

    await db.collection<Workspace>("workspaces").updateOne(
      { workspaceId: getWorkspaceId() },
      {
        $set: {
          workspaceId: getWorkspaceId(),
          packs: body.packs,
          groups: body.groups,
          tags: body.tags,
          updatedAt,
        },
      },
      { upsert: true },
    );

    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save workspace" },
      { status: 503 },
    );
  }
}
