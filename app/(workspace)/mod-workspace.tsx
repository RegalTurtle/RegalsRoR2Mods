"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Dispatch, SetStateAction, UIEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import ProfileDownload from "./profile-download";
import LogoutButton from "./logout-button";
import { CATALOG_MAX_AGE, readModCatalog, refreshModCatalog } from "@/lib/mod-catalog-cache";
import { readWorkspaceCache, writeWorkspaceCache } from "@/lib/workspace-cache";
import ModConfigPanel from "./mod-config-panel";

type ThunderstoreVersion = {
  version_number?: string;
  downloads?: number;
  date_created?: string;
  icon?: string;
  description?: string;
};

type ThunderstorePackage = {
  uuid4?: string;
  full_name?: string;
  owner?: string;
  name?: string;
  package_url?: string;
  date_updated?: string;
  rating_score?: number;
  total_downloads?: number;
  is_deprecated?: boolean;
  has_nsfw_content?: boolean;
  categories?: string[];
  versions?: ThunderstoreVersion[];
  latest?: ThunderstoreVersion;
  community_list?: { identifier?: string; name?: string }[];
  description?: string;
};

type Mod = {
  id: string;
  name: string;
  owner: string;
  description: string;
  categories: string[];
  downloads: number;
  rating: number;
  updated: string;
  version: string;
  dependency: string;
  url: string;
  thumbnailUrl: string;
  deprecated: boolean;
  nsfw: boolean;
};

type Pack = {
  id: string;
  name: string;
  color: string;
  notes: string;
  modIds: string[];
  curatedVersions?: Record<string, string>;
  configs?: Record<string, unknown>;
};

type ModGroup = {
  id: string;
  name: string;
  color: string;
  modIds: string[];
};

type ActiveCollection =
  | { type: "all"; id: "all" }
  | { type: "pack"; id: string }
  | { type: "group"; id: string };

type DraggedCollection = { type: "pack" | "group"; id: string } | null;
type PackContextMenu = { packId: string; x: number; y: number } | null;

type ModReview = {
  modId: string;
  rating: number;
  hasPlayed: boolean;
  wantsReplay: boolean | null;
  notes: string;
  updatedAt?: string;
};

type SortMode = "downloads" | "rating" | "updated" | "name";
type PlayedFilter = "all" | "played" | "unplayed";
type ReplayFilter = "all" | "yes" | "no" | "blank";

const STORAGE_KEY = "regals-ror2-mods";
const ALL_MODS_PAGE_SIZE = 100;

function normalizeReview(value: ModReview | undefined, modId: string): ModReview {
  return {
    modId,
    rating: value?.rating ?? 0,
    hasPlayed: value?.hasPlayed ?? false,
    wantsReplay: typeof value?.wantsReplay === "boolean" ? value.wantsReplay : null,
    notes: value?.notes ?? "",
    updatedAt: value?.updatedAt,
  };
}

const packColors = ["#00a6a6", "#e45a3c", "#7c6cff", "#d69e2e", "#2f855a"];
const groupColors = ["#7c6cff", "#2f855a", "#d69e2e", "#e45a3c", "#00a6a6"];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function formatDate(value: string) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

function normalizeUrl(value?: string) {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) return `https://thunderstore.io${value}`;
  return `https://thunderstore.io/${value}`;
}

function makeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function reorderById<T extends { id: string }>(items: T[], draggedId: string, targetId: string) {
  if (draggedId === targetId) return items;

  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1) return items;

  const next = [...items];
  const [draggedItem] = next.splice(draggedIndex, 1);
  next.splice(targetIndex, 0, draggedItem);
  return next;
}

function topPackCollection(packs: Pack[]): ActiveCollection {
  return packs[0] ? { type: "pack", id: packs[0].id } : { type: "all", id: "all" };
}

function normalizePackage(pkg: ThunderstorePackage): Mod {
  const latestVersion = pkg.versions?.[0];
  const latest = pkg.latest ?? latestVersion ?? {};
  const owner = pkg.owner ?? pkg.full_name?.split("-")[0] ?? "Unknown";
  const name = pkg.name ?? pkg.full_name?.split("-").slice(1).join("-") ?? "Unknown mod";
  const version = latest.version_number ?? latestVersion?.version_number ?? "latest";

  return {
    id: pkg.full_name ?? `${owner}-${name}`,
    name,
    owner,
    description:
      pkg.description ?? latest.description ?? latestVersion?.description ?? "No description provided by Thunderstore.",
    categories: pkg.categories?.length ? pkg.categories : ["Mods"],
    downloads: pkg.total_downloads ?? latest.downloads ?? latestVersion?.downloads ?? 0,
    rating: pkg.rating_score ?? 0,
    updated: pkg.date_updated ?? latest.date_created ?? latestVersion?.date_created ?? "",
    version,
    dependency: `${owner}-${name}-${version}`,
    url: pkg.package_url ?? `https://thunderstore.io/c/riskofrain2/p/${owner}/${name}/`,
    thumbnailUrl: normalizeUrl(latest.icon ?? latestVersion?.icon),
    deprecated: Boolean(pkg.is_deprecated),
    nsfw: Boolean(pkg.has_nsfw_content),
  };
}

async function fetchLiveMods(): Promise<Mod[]> {
  const response = await fetch("https://thunderstore.io/c/riskofrain2/api/v1/package/", { cache: "no-store" });
  if (!response.ok) throw new Error("Thunderstore sync failed");
  const data = await response.json() as ThunderstorePackage[];
  if (!Array.isArray(data)) throw new Error("Invalid Thunderstore catalog");
  return data.map(normalizePackage).filter((mod) => !mod.nsfw);
}

export default function ModWorkspace({ children, username, isAdmin }: { children: React.ReactNode; username: string; isAdmin: boolean }) {
  const storageKey = `${STORAGE_KEY}:${username}`;
  const pathname = usePathname();
  const router = useRouter();
  const segments = pathname.split("/").filter(Boolean);
  const activeCollection: ActiveCollection = segments[0] === "modpacks" && segments[1]
    ? { type: "pack", id: decodeURIComponent(segments[1]) }
    : segments[0] === "collections" && segments[1]
      ? { type: "group", id: decodeURIComponent(segments[1]) }
      : { type: "all", id: "all" };
  function setActiveCollection(collection: ActiveCollection) {
    router.push(collection.type === "all" ? "/" : "/" + (collection.type === "pack" ? "modpacks" : "collections") + "/" + encodeURIComponent(collection.id), { scroll: false });
  }
  const [mods, setMods] = useState<Mod[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [groups, setGroups] = useState<ModGroup[]>([]);
  const [tags, setTags] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [playedFilter, setPlayedFilter] = useState<PlayedFilter>("all");
  const [replayFilter, setReplayFilter] = useState<ReplayFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [selectedModId, setSelectedModId] = useState("");
  const [configStatus, setConfigStatus] = useState<{ packId: string; modIds: string[] }>({ packId: "", modIds: [] });
  const [newPackName, setNewPackName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newTag, setNewTag] = useState("");
  const [draggedCollection, setDraggedCollection] = useState<DraggedCollection>(null);
  const [packContextMenu, setPackContextMenu] = useState<PackContextMenu>(null);
  const [reviews, setReviews] = useState<Record<string, ModReview>>({});
  const [reviewModalModId, setReviewModalModId] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<ModReview | null>(null);
  const [reviewSaveState, setReviewSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [allModsPage, setAllModsPage] = useState({ scope: "", count: ALL_MODS_PAGE_SIZE });
  const [syncState, setSyncState] = useState<"idle" | "loading" | "synced" | "error">("idle");
  const [persistenceState, setPersistenceState] = useState<"loading" | "saving" | "synced" | "local" | "error">(
    "loading",
  );
  const [hasLoadedSavedWorkspace, setHasLoadedSavedWorkspace] = useState(false);
  const [hasLoadedPersistentWorkspace, setHasLoadedPersistentWorkspace] = useState(false);
  const centerColumnRef = useRef<HTMLElement>(null);
  const canSavePersistentWorkspace = useRef(false);
  const lastSavedWorkspace = useRef<string | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = readWorkspaceCache(localStorage, storageKey) ?? (isAdmin ? readWorkspaceCache(localStorage, STORAGE_KEY) : null); } catch { /* Storage can be disabled. */ }
    if (!saved) {
      const markLoaded = window.setTimeout(() => setHasLoadedSavedWorkspace(true), 0);
      return () => window.clearTimeout(markLoaded);
    }

    try {
      const parsed = JSON.parse(saved) as {
        mods?: Mod[];
        packs?: Pack[];
        groups?: ModGroup[];
        tags?: Record<string, string[]>;
      };
      const loadSavedWorkspace = window.setTimeout(() => {
        if (parsed.mods?.length) setMods(parsed.mods);
        if (isAdmin && parsed.packs?.length) {
          setPacks(parsed.packs);
        }
        if (isAdmin && parsed.groups?.length) setGroups(parsed.groups);
        if (isAdmin && parsed.tags) setTags(parsed.tags);
        setHasLoadedSavedWorkspace(true);
      }, 0);

      return () => window.clearTimeout(loadSavedWorkspace);
    } catch {
      // Ignore invalid cached data; do not delete potentially recoverable data.
      const markLoaded = window.setTimeout(() => setHasLoadedSavedWorkspace(true), 0);
      return () => window.clearTimeout(markLoaded);
    }
  }, [storageKey, isAdmin]);

  useEffect(() => {
    if (!hasLoadedSavedWorkspace) return;
    const cachedPacks = packs.map(({ id, name, color, notes, modIds, curatedVersions }) => ({ id, name, color, notes, modIds, curatedVersions }));
    const compact = isAdmin ? { packs: cachedPacks, groups, tags } : {};
    try { writeWorkspaceCache(localStorage, storageKey, compact, compact); } catch { /* Caching is optional. */ }
  }, [groups, hasLoadedSavedWorkspace, packs, tags, storageKey, isAdmin]);

  useEffect(() => {
    if (!hasLoadedSavedWorkspace) return;
    let ignore = false;
    async function restoreCatalog() {
      const cached = await readModCatalog<Mod>();
      if (ignore) return;
      if (cached?.mods.length) {
        setMods(cached.mods);
        setSyncState("synced");
        if (Date.now() - cached.updatedAt < CATALOG_MAX_AGE) return;
      }
      setSyncState("loading");
      try {
        const fresh = await refreshModCatalog(fetchLiveMods);
        if (!ignore) { setMods(fresh.mods); setSyncState("synced"); }
      } catch { if (!ignore) setSyncState("error"); }
    }
    void restoreCatalog();
    return () => { ignore = true; };
  }, [hasLoadedSavedWorkspace]);

  useEffect(() => {
    if (!hasLoadedSavedWorkspace) return;
    let ignore = false;

    async function loadWorkspace() {
      try {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        if (!response.ok) throw new Error("Mongo workspace unavailable");

        const workspace = (await response.json()) as {
          exists?: boolean;
          packs?: Pack[];
          groups?: ModGroup[];
          tags?: Record<string, string[]>;
        };

        if (ignore) return;
        lastSavedWorkspace.current = workspace.exists !== false
          ? JSON.stringify({ packs: workspace.packs ?? [], groups: workspace.groups ?? [], tags: workspace.tags ?? {} })
          : JSON.stringify({ packs: [], groups: [], tags: {} });
        if (workspace.exists !== false && workspace.packs) {
          setPacks(workspace.packs);
        }
        if (workspace.exists !== false && workspace.groups) setGroups(workspace.groups);
        if (workspace.exists !== false && workspace.tags) setTags(workspace.tags);
        canSavePersistentWorkspace.current = true;
        setPersistenceState("synced");
      } catch {
        if (!ignore) setPersistenceState("local");
      } finally {
        if (!ignore) setHasLoadedPersistentWorkspace(true);
      }
    }

    loadWorkspace();

    return () => {
      ignore = true;
    };
  }, [hasLoadedSavedWorkspace, isAdmin]);

  useEffect(() => {
    if (!hasLoadedPersistentWorkspace || !hasLoadedSavedWorkspace || !canSavePersistentWorkspace.current) return;
    const snapshot = JSON.stringify({ packs, groups, tags });
    if (snapshot === lastSavedWorkspace.current) return;

    const saveWorkspace = window.setTimeout(async () => {
      setPersistenceState("saving");

      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: snapshot,
        });

        if (!response.ok) throw new Error("Mongo workspace save failed");
        lastSavedWorkspace.current = snapshot;
        setPersistenceState("synced");
      } catch {
        setPersistenceState("error");
      }
    }, 500);

    return () => window.clearTimeout(saveWorkspace);
  }, [groups, hasLoadedPersistentWorkspace, hasLoadedSavedWorkspace, packs, tags]);

  useEffect(() => {
    if (!packContextMenu) return;

    function closeMenu() {
      setPackContextMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPackContextMenu(null);
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [packContextMenu]);

  useEffect(() => {
    if (!reviewDraft) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeReviewModal();
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [reviewDraft]);

  useEffect(() => {
    let ignore = false;

    async function loadReviews() {
      try {
        const response = await fetch("/api/mod-reviews", { cache: "no-store" });
        if (!response.ok) throw new Error("Review data unavailable");

        const data = (await response.json()) as { reviews?: Record<string, ModReview> };
        if (!ignore) {
          setReviews(
            Object.fromEntries(
              Object.entries(data.reviews ?? {}).map(([modId, review]) => [modId, normalizeReview(review, modId)]),
            ),
          );
        }
      } catch {
        if (!ignore) setReviews({});
      }
    }

    loadReviews();

    return () => {
      ignore = true;
    };
  }, []);

  const selectedMod = mods.find((mod) => mod.id === selectedModId) ?? mods[0];
  const reviewModalMod = reviewModalModId ? mods.find((mod) => mod.id === reviewModalModId) : undefined;

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(mods.flatMap((mod) => mod.categories))).sort()],
    [mods],
  );

  const activePack = activeCollection.type === "pack" ? packs.find((pack) => pack.id === activeCollection.id) : undefined;
  const configPackId = activePack?.id;
  useEffect(() => {
    if (!configPackId) return;
    let ignore = false;
    fetch(`/api/mod-configs?packId=${encodeURIComponent(configPackId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { configs: { modId: string }[] };
        if (!ignore) setConfigStatus({ packId: configPackId, modIds: data.configs.map((config) => config.modId) });
      }).catch(() => {});
    return () => { ignore = true; };
  }, [configPackId]);
  const activeGroup =
    activeCollection.type === "group" ? groups.find((group) => group.id === activeCollection.id) : undefined;

  const collectionMods = useMemo(
    () =>
      mods.filter((mod) => {
        const matchesPack = activeCollection.type !== "pack" || Boolean(activePack?.modIds.includes(mod.id));
        const matchesGroup = activeCollection.type !== "group" || Boolean(activeGroup?.modIds.includes(mod.id));
        return matchesPack && matchesGroup;
      }),
    [activeGroup, activePack, activeCollection.type, mods],
  );

  const allTags = useMemo(
    () => ["All", ...Array.from(new Set(Object.values(tags).flat())).sort()],
    [tags],
  );

  const filteredMods = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const compactQuery = normalizeSearchText(query);

    return collectionMods
      .filter((mod) => {
        const modTags = tags[mod.id] ?? [];
        const review = normalizeReview(reviews[mod.id], mod.id);
        const searchableText = [mod.name, mod.owner, mod.description, mod.dependency, ...mod.categories, ...modTags].join(
          " ",
        );
        const matchesQuery =
          !normalizedQuery ||
          searchableText.toLowerCase().includes(normalizedQuery) ||
          normalizeSearchText(searchableText).includes(compactQuery);
        const matchesCategory =
          selectedCategories.length === 0 || selectedCategories.every((item) => mod.categories.includes(item));
        const matchesTag =
          selectedTags.length === 0 || selectedTags.every((item) => modTags.includes(item));
        const matchesPlayed =
          playedFilter === "all" ||
          (playedFilter === "played" && review.hasPlayed) ||
          (playedFilter === "unplayed" && !review.hasPlayed);
        const matchesReplay =
          replayFilter === "all" ||
          (replayFilter === "yes" && review.wantsReplay === true) ||
          (replayFilter === "no" && review.wantsReplay === false) ||
          (replayFilter === "blank" && review.wantsReplay === null);
        return matchesQuery && matchesCategory && matchesTag && matchesPlayed && matchesReplay;
      })
      .sort((a, b) => {
        if (sortMode === "name") return a.name.localeCompare(b.name);
        if (sortMode === "rating") return b.rating - a.rating;
        if (sortMode === "updated") return new Date(b.updated).getTime() - new Date(a.updated).getTime();
        return b.downloads - a.downloads;
      });
  }, [collectionMods, playedFilter, query, replayFilter, reviews, selectedCategories, selectedTags, sortMode, tags]);

  const activeCollectionName =
    activeCollection.type === "pack"
      ? packs.find((pack) => pack.id === activeCollection.id)?.name ?? "Selected pack"
      : activeCollection.type === "group"
        ? groups.find((group) => group.id === activeCollection.id)?.name ?? "Selected group"
        : "All Mods";

  const allModsPageScope = `${activeCollection.type}:${activeCollection.id}|${selectedCategories.join(",")}|${selectedTags.join(",")}|${playedFilter}|${replayFilter}|${sortMode}|${query}`;
  const allModsVisibleCount =
    allModsPage.scope === allModsPageScope ? allModsPage.count : ALL_MODS_PAGE_SIZE;
  const visibleMods =
    activeCollection.type === "all" ? filteredMods.slice(0, allModsVisibleCount) : filteredMods;
  const hasMoreAllMods = activeCollection.type === "all" && visibleMods.length < filteredMods.length;

  useEffect(() => {
    centerColumnRef.current?.scrollTo({ top: 0 });
  }, [allModsPageScope]);

  function loadMoreAllMods() {
    if (activeCollection.type !== "all") return;
    setAllModsPage({
      scope: allModsPageScope,
      count: Math.min(allModsVisibleCount + ALL_MODS_PAGE_SIZE, filteredMods.length),
    });
  }

  function toggleFilterValue(value: string, setter: Dispatch<SetStateAction<string[]>>) {
    setter((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function handleCenterScroll(event: UIEvent<HTMLElement>) {
    if (activeCollection.type !== "all" || !hasMoreAllMods) return;

    const target = event.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining < 360) loadMoreAllMods();
  }

  async function syncThunderstore() {
    setSyncState("loading");
    try {
      const { mods: liveMods } = await refreshModCatalog(fetchLiveMods);
      setMods(liveMods);
      setSelectedModId(liveMods[0]?.id ?? selectedModId);
      setSyncState("synced");
    } catch {
      setSyncState("error");
    }
  }

  function createPack() {
    if (!isAdmin) return;
    const name = newPackName.trim();
    if (!name) return;
    const id = makeId(name);
    if (!id) return;
    if (packs.some((pack) => pack.id === id || pack.name.toLowerCase() === name.toLowerCase())) return;

    setPacks((current) => [
      ...current,
      {
        id,
        name,
        color: packColors[current.length % packColors.length],
        notes: "",
        modIds: selectedMod ? [selectedMod.id] : [],
      },
    ]);
    setNewPackName("");
    setActiveCollection({ type: "pack", id });
  }

  function createGroup() {
    if (!isAdmin) return;
    const name = newGroupName.trim();
    if (!name) return;
    const id = makeId(name);
    if (!id) return;
    if (id === "all" || groups.some((group) => group.id === id || group.name.toLowerCase() === name.toLowerCase())) {
      return;
    }

    setGroups((current) => [
      ...current,
      {
        id,
        name,
        color: groupColors[current.length % groupColors.length],
        modIds: selectedMod ? [selectedMod.id] : [],
      },
    ]);
    setNewGroupName("");
    setActiveCollection({ type: "group", id });
  }

  async function togglePackMod(packId: string, modId: string) {
    const target = packs.find((pack) => pack.id === packId);
    if (!target) return;
    const adding = !target.modIds.includes(modId);
    if (adding && activePack && activePack.id !== packId && activePack.modIds.includes(modId)) {
      try {
        const response = await fetch("/api/mod-configs", { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourcePackId: activePack.id, targetPackId: packId, modId }) });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error ?? "Unable to add mod and copy config.");
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Unable to add mod and copy config.");
        return;
      }
    }
    setPacks((current) =>
      current.map((pack) =>
        pack.id === packId
          ? {
              ...pack,
              modIds: adding
                ? Array.from(new Set([...pack.modIds, modId]))
                : pack.modIds.filter((id) => id !== modId),
            }
          : pack,
      ),
    );
  }

  function deletePack(packId: string) {
    if (!isAdmin) return;
    const pack = packs.find((item) => item.id === packId);
    if (!pack || !window.confirm(`Delete mod pack "${pack.name}"?`)) return;

    const nextPacks = packs.filter((item) => item.id !== packId);
    setPacks(nextPacks);
    setPackContextMenu(null);

    if (activeCollection.type === "pack" && activeCollection.id === packId) {
      setActiveCollection(topPackCollection(nextPacks));
    }
  }

  function toggleGroupMod(groupId: string, modId: string) {
    if (!isAdmin) return;
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              modIds: group.modIds.includes(modId)
                ? group.modIds.filter((id) => id !== modId)
                : [...group.modIds, modId],
            }
          : group,
      ),
    );
  }

  function dropCollection(type: "pack" | "group", targetId: string) {
    if (!isAdmin) return;
    if (!draggedCollection || draggedCollection.type !== type) return;

    if (type === "pack") {
      setPacks((current) => reorderById(current, draggedCollection.id, targetId));
    } else {
      setGroups((current) => reorderById(current, draggedCollection.id, targetId));
    }

    setDraggedCollection(null);
  }

  function addTag() {
    const value = newTag.trim().toLowerCase();
    if (!value || !selectedMod) return;
    setTags((current) => ({
      ...current,
      [selectedMod.id]: Array.from(new Set([...(current[selectedMod.id] ?? []), value])),
    }));
    setNewTag("");
  }

  function removeTag(modId: string, tag: string) {
    setTags((current) => ({ ...current, [modId]: (current[modId] ?? []).filter((item) => item !== tag) }));
  }

  function openReviewModal(mod: Mod) {
    setReviewModalModId(mod.id);
    setReviewDraft(normalizeReview(reviews[mod.id], mod.id));
    setReviewSaveState("idle");
  }

  function closeReviewModal() {
    setReviewModalModId(null);
    setReviewDraft(null);
    setReviewSaveState("idle");
  }

  async function saveReview() {
    if (!reviewDraft) return;
    setReviewSaveState("saving");

    try {
      const response = await fetch("/api/mod-reviews", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewDraft),
      });

      if (!response.ok) throw new Error("Review save failed");
      const data = (await response.json()) as { review?: ModReview };
      const savedReview = data.review ?? reviewDraft;
      setReviews((current) => ({ ...current, [savedReview.modId]: savedReview }));
      setReviewDraft(savedReview);
      setReviewSaveState("saved");
    } catch {
      setReviewSaveState("error");
    }
  }

  return (
    <main className={`${isAdmin ? "" : "member-view "}app-shell bg-[var(--background)] text-[var(--foreground)]`}>
      {packContextMenu && (
        <div
          className="context-menu"
          style={{ left: packContextMenu.x, top: packContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          role="menu"
        >
          <button
            className="context-menu-item context-menu-danger"
            type="button"
            role="menuitem"
            onClick={() => deletePack(packContextMenu.packId)}
          >
            Delete pack
          </button>
        </div>
      )}

      {reviewDraft && reviewModalMod && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-title"
          onClick={closeReviewModal}
        >
          <div className="review-modal" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--muted)]">Mod notes</p>
                <h2 id="review-title" className="force-wrap mt-1 text-2xl font-black">
                  {reviewModalMod.name}
                </h2>
                <p className="force-wrap font-semibold text-[var(--muted)]">by {reviewModalMod.owner}</p>
              </div>
              <button className="icon-button" type="button" onClick={closeReviewModal} title="Close review">
                x
              </button>
            </div>

            <div className="mt-5">
              <div className="field-label">Rating</div>
              <div className="rating-row" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    className={`rating-button ${reviewDraft.rating >= value ? "rating-button-active" : ""}`}
                    type="button"
                    onClick={() =>
                      setReviewDraft((current) =>
                        current ? { ...current, rating: current.rating === value ? 0 : value } : current,
                      )
                    }
                    aria-label={`${value} out of 5`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="field-label">Played it</div>
                <div className="pill-control" role="group" aria-label="Played it">
                  <button
                    className={`pill-option ${!reviewDraft.hasPlayed ? "pill-option-active" : ""}`}
                    type="button"
                    onClick={() => setReviewDraft((current) => (current ? { ...current, hasPlayed: false } : current))}
                  >
                    No
                  </button>
                  <button
                    className={`pill-option ${reviewDraft.hasPlayed ? "pill-option-active" : ""}`}
                    type="button"
                    onClick={() => setReviewDraft((current) => (current ? { ...current, hasPlayed: true } : current))}
                  >
                    Yes
                  </button>
                </div>
              </div>
              <div>
                <div className="field-label">Want to play again</div>
                <div className="pill-control" role="group" aria-label="Want to play again">
                  <button
                    className={`pill-option ${reviewDraft.wantsReplay === false ? "pill-option-active" : ""}`}
                    type="button"
                    onClick={() =>
                      setReviewDraft((current) =>
                        current ? { ...current, wantsReplay: current.wantsReplay === false ? null : false } : current,
                      )
                    }
                  >
                    No
                  </button>
                  <button
                    className={`pill-option ${reviewDraft.wantsReplay === true ? "pill-option-active" : ""}`}
                    type="button"
                    onClick={() =>
                      setReviewDraft((current) =>
                        current ? { ...current, wantsReplay: current.wantsReplay === true ? null : true } : current,
                      )
                    }
                  >
                    Yes
                  </button>
                </div>
              </div>
            </div>

            <label className="field-label" htmlFor="review-notes">
              Notes
            </label>
            <textarea
              id="review-notes"
              className="review-notes"
              value={reviewDraft.notes}
              onChange={(event) =>
                setReviewDraft((current) => (current ? { ...current, notes: event.target.value } : current))
              }
              placeholder="Build notes, balance thoughts, multiplayer chaos level..."
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-bold text-[var(--muted)]">
                {reviewSaveState === "saving" && "Saving..."}
                {reviewSaveState === "saved" && "Saved"}
                {reviewSaveState === "error" && "Save failed"}
              </p>
              <button className="command-button px-4" type="button" disabled={!isAdmin} onClick={saveReview}>
                Save review
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="app-header border-b border-[var(--border)] bg-[var(--surface-deep)] text-white">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-light)]">
              Regal&apos;s Risk of Rain 2 Mod Organizer
            </p>
          </div>
          <div className="flex items-center gap-3">{isAdmin && <Link className="small-button" href="/admin/users">Manage users</Link>}<Link className="small-button" href="/account">Account</Link><LogoutButton /></div>
        </div>
      </section>

      <section className="app-columns grid w-full gap-5 px-5 pt-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,12fr)_minmax(0,5fr)]">
        <aside className="scroll-column workspace-nav space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
            <h2 className="text-lg font-bold">Mod Packs</h2>
            <div className="mt-4 flex gap-2">
              <input
                className="text-field"
                value={newPackName}
                onChange={(event) => setNewPackName(event.target.value)}
                placeholder="Eclipse practice"
              />
              <button className="command-button w-12" type="button" onClick={createPack} title="Create pack">
                +
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {packs.map((pack) => {
                const inPack = selectedMod ? pack.modIds.includes(selectedMod.id) : false;
                return (
                  <div
                    key={pack.id}
                    className={`collection-card ${
                      activeCollection.type === "pack" && activeCollection.id === pack.id ? "collection-card-active" : ""
                    } ${draggedCollection?.type === "pack" && draggedCollection.id === pack.id ? "collection-card-dragging" : ""}`}
                    draggable
                    role="button"
                    tabIndex={0}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", pack.id);
                      setDraggedCollection({ type: "pack", id: pack.id });
                    }}
                    onDragOver={(event) => {
                      if (draggedCollection?.type === "pack") event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropCollection("pack", pack.id);
                    }}
                    onDragEnd={() => setDraggedCollection(null)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setPackContextMenu({ packId: pack.id, x: event.clientX, y: event.clientY });
                    }}
                    onClick={() => setActiveCollection({ type: "pack", id: pack.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveCollection({ type: "pack", id: pack.id });
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-sm" style={{ background: pack.color }} />
                          <Link className="truncate font-bold" href={`/modpacks/${encodeURIComponent(pack.id)}`} aria-current={activePack?.id === pack.id ? "page" : undefined} onClick={(event) => event.stopPropagation()}>{pack.name}</Link>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">{pack.modIds.length} mods</p>
                      </div>
                      {selectedMod && (
                        <button
                          className={`small-button ${inPack ? "small-button-active" : ""}`}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePackMod(pack.id, selectedMod.id);
                          }}
                        >
                          {inPack ? "Remove" : "Add"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="collection-navigation rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
            <h2 className="text-lg font-bold">Collections</h2>
            <div className="mt-4 flex gap-2">
              <input
                className="text-field"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                placeholder="UI polish"
              />
              <button className="command-button w-12" type="button" onClick={createGroup} title="Create group">
                +
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <button
                className={`collection-card w-full text-left ${
                  activeCollection.type === "all" ? "collection-card-active" : ""
                }`}
                type="button"
                onClick={() => setActiveCollection({ type: "all", id: "all" })}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm bg-[var(--surface-deep)]" />
                      <strong>All Mods</strong>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{mods.length} mods</p>
                  </div>
                </div>
              </button>

              {groups.map((group) => {
                const inGroup = selectedMod ? group.modIds.includes(selectedMod.id) : false;
                return (
                  <div
                    key={group.id}
                    className={`collection-card ${
                      activeCollection.type === "group" && activeCollection.id === group.id
                        ? "collection-card-active"
                        : ""
                    } ${
                      draggedCollection?.type === "group" && draggedCollection.id === group.id
                        ? "collection-card-dragging"
                        : ""
                    }`}
                    draggable
                    role="button"
                    tabIndex={0}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", group.id);
                      setDraggedCollection({ type: "group", id: group.id });
                    }}
                    onDragOver={(event) => {
                      if (draggedCollection?.type === "group") event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropCollection("group", group.id);
                    }}
                    onDragEnd={() => setDraggedCollection(null)}
                    onClick={() => setActiveCollection({ type: "group", id: group.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveCollection({ type: "group", id: group.id });
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-sm" style={{ background: group.color }} />
                          <Link className="truncate font-bold" href={`/collections/${encodeURIComponent(group.id)}`} aria-current={activeGroup?.id === group.id ? "page" : undefined} onClick={(event) => event.stopPropagation()}>{group.name}</Link>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">{group.modIds.length} mods</p>
                      </div>
                      {selectedMod && (
                        <button
                          className={`small-button ${inGroup ? "small-button-active" : ""}`}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleGroupMod(group.id, selectedMod.id);
                          }}
                        >
                          {inGroup ? "Remove" : "Add"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section ref={centerColumnRef} className="scroll-column mod-column min-w-0" onScroll={handleCenterScroll}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">{activeCollection.type === "pack" ? "Modpack" : activeCollection.type === "group" ? "Collection" : "Library"}</p><h1 className="text-2xl font-black">{activeCollectionName}</h1><p className="text-sm text-[var(--muted)]">{filteredMods.length} matching mods</p></div>
            <button
              className="small-button"
              type="button"
              onClick={() => {
                setQuery("");
                setSelectedCategories([]);
                setSelectedTags([]);
                setPlayedFilter("all");
                setReplayFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>

          <div className="mb-4">
            {activePack && <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4"><label className="field-label !mt-0" htmlFor="pack-notes">Modpack notes</label><textarea id="pack-notes" className="text-field" value={activePack.notes} onChange={(event) => setPacks((current) => current.map((pack) => pack.id === activePack.id ? { ...pack, notes: event.target.value } : pack))} placeholder="Notes and load order reminders" /></div>}
            {hasLoadedPersistentWorkspace && activeCollection.type !== "all" && !activePack && !activeGroup && <p className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">This {activeCollection.type === "pack" ? "modpack" : "collection"} could not be found. Choose one from the left sidebar.</p>}
          </div>
          {activePack && <ProfileDownload key={activePack.id} pack={activePack} />}
          <div className="mod-list grid gap-2">
            {visibleMods.map((mod) => {
              const active = selectedMod?.id === mod.id;
              return (
                <article key={mod.id}>
                <button
                  className={`mod-row ${active ? "mod-row-active" : ""}`}
                  type="button"
                  onClick={() => setSelectedModId(mod.id)}
                >
                  <div className="flex items-start gap-3">
                    <ModThumbnail mod={mod} size="sm" />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="force-wrap text-base font-black">{mod.name}</span><span className="text-xs text-[var(--muted)]">v{mod.version}</span>
                        <span className="rounded bg-[var(--selected)] px-2 py-1 text-xs font-bold text-[var(--accent-light)]">
                          {mod.owner}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--secondary)]">{mod.description}</p>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col text-left">
                    <div className="mt-3 flex flex-wrap gap-2">
                      {mod.categories.slice(0, 4).map((item) => (
                        <Pill key={item}>{item}</Pill>
                      ))}
                      {mod.deprecated && <Pill tone="deprecated">Deprecated</Pill>}
                      {(tags[mod.id] ?? []).slice(0, 4).map((item) => (
                        <Pill key={item} tone="tag">
                          #{item}
                        </Pill>
                      ))}
                    </div>
                  </div>
                  <div className="grid shrink-0 gap-1 text-left text-sm sm:text-right">
                    <strong>{formatNumber(mod.downloads)}</strong>
                    <span className="text-[var(--muted)]">downloads</span>
                    <span className="font-semibold text-[var(--tag-text)]">{mod.rating} likes</span>
                  </div>
                </button>
                {activePack && <ModConfigPanel key={`${mod.id}:${activePack.id}`} modId={mod.id} version={mod.version} packId={activePack.id} packName={activePack.name} canEdit={true} hasConfig={configStatus.packId === activePack.id ? configStatus.modIds.includes(mod.id) : Boolean(activePack.configs?.[mod.id])} />}
                </article>
              );
            })}
          </div>
          {activeCollection.type === "all" && (
            <div className="py-5 text-center text-sm font-bold text-[var(--muted)]">
              Showing {visibleMods.length} of {filteredMods.length}
              {hasMoreAllMods && (
                <button className="small-button ml-3" type="button" onClick={loadMoreAllMods}>
                  Load 100 more
                </button>
              )}
            </div>
          )}
        </section>

        <aside className="scroll-column right-column flex flex-col gap-4">
          {selectedMod && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <ModThumbnail mod={selectedMod} size="lg" />
                  <button
                    className="review-title-button force-wrap mt-3 text-left text-2xl font-black leading-7"
                    type="button"
                    onClick={() => openReviewModal(selectedMod)}
                  >
                    {selectedMod.name}
                  </button>
                  <p className="force-wrap mt-1 font-semibold text-[var(--muted)]">by {selectedMod.owner}</p>
                </div>
                <a className="icon-button" href={selectedMod.url} target="_blank" rel="noreferrer" title="Open on Thunderstore">
                  ↗
                </a>
              </div>
              <p className="mt-4 text-sm leading-6 text-[var(--secondary)]">{selectedMod.description}</p>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <Info label="Version" value={selectedMod.version} />
                <Info label="Updated" value={formatDate(selectedMod.updated)} />
                <Info label="Downloads" value={formatNumber(selectedMod.downloads)} />
                <Info label="Likes" value={selectedMod.rating.toString()} />
              </dl>
              <div className="mt-4 rounded bg-[var(--selected)] p-3 font-mono text-xs text-[var(--accent-light)]">
                {selectedMod.dependency}
              </div>
              <button
                className="review-summary mt-4 w-full text-left"
                type="button"
                onClick={() => openReviewModal(selectedMod)}
              >
                <strong>Your review</strong>
                <span>
                  {reviews[selectedMod.id]
                    ? `${reviews[selectedMod.id].rating || "No"} / 5, ${
                        reviews[selectedMod.id].hasPlayed ? "played" : "not played"
                      }${
                        reviews[selectedMod.id].wantsReplay === null
                          ? ""
                          : reviews[selectedMod.id].wantsReplay
                            ? ", replay yes"
                            : ", replay no"
                      }`
                    : "Add rating and notes"}
                </span>
              </button>

              <h3 className="mt-5 font-bold">Tags</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedMod.deprecated && <Pill tone="deprecated">Deprecated</Pill>}
                {(tags[selectedMod.id] ?? []).map((item) => (
                  <button
                    key={item}
                    className="rounded bg-[var(--tag-bg)] px-2 py-1 text-xs font-bold text-[var(--tag-text)]"
                    type="button"
                    onClick={() => removeTag(selectedMod.id, item)}
                    title={`Remove ${item}`}
                  >
                    #{item} ×
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  className="text-field"
                  value={newTag}
                  onChange={(event) => setNewTag(event.target.value)}
                  placeholder="ui, core, meme"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addTag();
                  }}
                />
                <button className="command-button w-12" type="button" onClick={addTag} title="Add tag">
                  +
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Filters</h2>
              <button className="icon-button" type="button" onClick={syncThunderstore} title="Sync Thunderstore">
                {syncState === "loading" ? "..." : "↻"}
              </button>
            </div>
            <p className="mt-2 min-h-5 text-sm text-[var(--muted)]">
              {syncState === "synced" && "Mod catalog ready. Automatically refreshed every 6 hours."}
              {syncState === "error" && "Catalog refresh failed. Using cached mods when available."}
              {syncState === "idle" && "Mod catalog loads automatically."}
              {syncState === "loading" && "Fetching packages from Thunderstore..."}
            </p>
            <p className="mt-2 rounded bg-[var(--selected)] px-3 py-2 text-xs font-bold text-[var(--accent-light)]">
              {persistenceState === "loading" && "Storage: connecting to Mongo..."}
              {persistenceState === "saving" && "Storage: saving packs, groups, and tags..."}
              {persistenceState === "synced" && "Storage: Mongo synced"}
              {persistenceState === "local" && "Storage: local fallback"}
              {persistenceState === "error" && "Storage: Mongo save failed"}
            </p>

            <label className="field-label mt-5" htmlFor="search">
              Search
            </label>
            <input
              id="search"
              className="text-field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="mod, author, dependency, tag"
            />

            <div className="field-label">Categories</div>
            <details className="filter-dropdown">
              <summary>
                {selectedCategories.length === 0 ? "All categories" : `${selectedCategories.length} selected`}
              </summary>
              <div className="checkbox-list">
                {categories
                  .filter((item) => item !== "All")
                  .map((item) => (
                    <label key={item} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(item)}
                        onChange={() => toggleFilterValue(item, setSelectedCategories)}
                      />
                      <span>{item}</span>
                    </label>
                  ))}
              </div>
            </details>

            <div className="field-label">Tags</div>
            <details className="filter-dropdown">
              <summary>{selectedTags.length === 0 ? "All tags" : `${selectedTags.length} selected`}</summary>
              <div className="checkbox-list">
                {allTags
                  .filter((item) => item !== "All")
                  .map((item) => (
                    <label key={item} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedTags.includes(item)}
                        onChange={() => toggleFilterValue(item, setSelectedTags)}
                      />
                      <span>#{item}</span>
                    </label>
                  ))}
                {allTags.length === 1 && <p className="px-1 py-2 text-sm text-[var(--muted)]">No tags yet.</p>}
              </div>
            </details>

            <label className="field-label" htmlFor="playedFilter">
              Played
            </label>
            <select
              id="playedFilter"
              className="text-field"
              value={playedFilter}
              onChange={(event) => setPlayedFilter(event.target.value as PlayedFilter)}
            >
              <option value="all">Played and unplayed</option>
              <option value="played">Played only</option>
              <option value="unplayed">Unplayed only</option>
            </select>

            <label className="field-label" htmlFor="replayFilter">
              Play Again
            </label>
            <select
              id="replayFilter"
              className="text-field"
              value={replayFilter}
              onChange={(event) => setReplayFilter(event.target.value as ReplayFilter)}
            >
              <option value="all">Any replay status</option>
              <option value="yes">Would play again</option>
              <option value="no">Would not play again</option>
              <option value="blank">No replay answer</option>
            </select>

            <label className="field-label" htmlFor="sort">
              Sort
            </label>
            <select
              id="sort"
              className="text-field"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              <option value="downloads">Most downloaded</option>
              <option value="rating">Highest rated</option>
              <option value="updated">Recently updated</option>
              <option value="name">Name</option>
            </select>
          </div>

        </aside>
      </section>
      {children}
    </main>
  );
}

function Pill({
  children,
  tone = "category",
}: {
  children: React.ReactNode;
  tone?: "category" | "tag" | "deprecated";
}) {
  const toneClass =
    tone === "deprecated"
      ? "bg-[var(--danger-bg)] text-[var(--danger)]"
      : tone === "tag"
        ? "bg-[var(--tag-bg)] text-[var(--tag-text)]"
        : "bg-[var(--category-bg)] text-[var(--category-text)]";

  return (
    <span className={`rounded px-2 py-1 text-xs font-bold ${toneClass}`}>
      {children}
    </span>
  );
}

function ModThumbnail({ mod, size }: { mod: Mod; size: "sm" | "lg" }) {
  const className = size === "lg" ? "mod-thumbnail mod-thumbnail-lg" : "mod-thumbnail";
  const initials = mod.name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  if (mod.thumbnailUrl) {
    return (
      <Image
        className={className}
        src={mod.thumbnailUrl}
        alt={`${mod.name} icon`}
        width={size === "lg" ? 68 : 52}
        height={size === "lg" ? 68 : 52}
      />
    );
  }

  return (
    <div className={`${className} mod-thumbnail-fallback`} aria-hidden="true">
      {initials || "R2"}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-[var(--surface-hover)] p-3">
      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}
