export type AccountAccess = {
  role: "admin" | "member";
  allPacks: boolean;
  allGroups: boolean;
  packIds: string[];
  groupIds: string[];
};

export function accountAccess(value: Record<string, unknown>): AccountAccess {
  const ids = (list: unknown) => Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  return { role: value.role === "admin" ? "admin" : "member", allPacks: value.allPacks === true,
    allGroups: value.allGroups === true, packIds: ids(value.packIds), groupIds: ids(value.groupIds) };
}
export function canSeePack(user: AccountAccess, id: string) { return user.role === "admin" || user.allPacks || user.packIds.includes(id); }
export function canSeeGroup(user: AccountAccess, id: string) { return user.role === "admin" || user.allGroups || user.groupIds.includes(id); }
