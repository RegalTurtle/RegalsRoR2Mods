import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { parse, stringify } from "yaml";

export type PackageVersion = { version_number: string; dependencies: string[]; is_active?: boolean };
export type ProfilePackage = { full_name: string; versions: PackageVersion[] };
export type ProfileMod = { name: string; version: { major: number; minor: number; patch: number }; enabled: boolean };
export type ConfigTemplate = {
  modId: string;
  sourceVersion?: string;
  appliesToAllVersions?: boolean;
  supportedVersions: string[];
  path: string; // Relative to BepInEx/config, including any subfolders.
  content: string; // Original file text, including comments, whitespace and line endings.
};

export function versionParts(value: string) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Unsupported version: ${value}`);
  const [major, minor, patch] = value.split(".").map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) throw new Error(`Invalid version: ${value}`);
  return { major, minor, patch };
}

export function resolveProfile(selected: string[], catalog: ProfilePackage[]): ProfileMod[] {
  if (!selected.length) throw new Error("This modpack has no mods to export.");
  const packages = new Map(catalog.map((pkg) => [pkg.full_name, pkg]));
  const resolved = new Set<string>();
  const result: ProfileMod[] = [];
  function compare(a: string, b: string) {
    const av = Object.values(versionParts(a));
    const bv = Object.values(versionParts(b));
    for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
    return 0;
  }
  function visit(name: string, minimum?: string, by = "Modpack") {
    const version = packages.get(name)?.versions.filter((item) => item.is_active !== false)
      .sort((a, b) => compare(b.version_number, a.version_number))[0];
    if (!version) throw new Error("Unavailable package: " + name + " (" + by + ").");
    if (minimum && compare(version.version_number, minimum) < 0) throw new Error("Dependency conflict: " + by + " requires " + name + " " + minimum + " or newer, but latest available is " + version.version_number);
    if (resolved.has(name)) return;
    if (!Array.isArray(version.dependencies)) throw new Error("Missing dependency metadata: " + name);
    resolved.add(name);
    for (const dependency of version.dependencies) {
      const match = /^(.+)-(\d+\.\d+\.\d+)$/.exec(dependency);
      if (!match) throw new Error("Invalid dependency: " + dependency + " (" + name + ").");
      visit(match[1], match[2], name);
    }
    result.push({ name, version: versionParts(version.version_number), enabled: true });
  }
  for (const name of new Set(selected)) visit(name);
  return result;
}

export function configPath(path: string) {
  if (!path || path.includes("\\") || path.startsWith("/") || path.split("/").some((part) =>
    !part || part === "." || part === ".." || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Unsafe config path: ${path}`);
  if (!/\.(cfg|txt|json|yml|yaml|ini)$/i.test(path)) throw new Error(`Unsupported config file: ${path}`);
  return `config/${path}`;
}

export function buildProfileArchive(profileName: string, mods: ProfileMod[], templates: ConfigTemplate[] = []) {
  if (!profileName.trim() || profileName !== profileName.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(profileName) ||
    /[. ]$/.test(profileName) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(profileName) || profileName === "." || profileName === "..") throw new Error("Modpack name is not a valid profile name.");
  if (!mods.length || new Set(mods.map((mod) => mod.name)).size !== mods.length) throw new Error("Invalid resolved mod list.");
  const versions = new Map(mods.map((mod) => [mod.name, `${mod.version.major}.${mod.version.minor}.${mod.version.patch}`]));
  const manifest = { profileName, mods };
  const files: Record<string, Uint8Array> = { "export.r2x": strToU8(stringify(manifest)) };
  const paths = new Set<string>();
  const groups = new Map<string, ConfigTemplate[]>();
  for (const template of templates) {
    if (!versions.has(template.modId)) continue;
    configPath(template.path);
    const key = `${template.modId}/${template.path.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), template]);
  }
  for (const candidates of groups.values()) {
    const version = versions.get(candidates[0].modId)!;
    const matching = candidates.filter((template) => template.appliesToAllVersions || template.supportedVersions.includes(version));
    if (matching.length !== 1) throw new Error(`Config ${candidates[0].path} needs exactly one template supporting ${candidates[0].modId} ${version}.`);
    const template = matching[0];
    const path = configPath(template.path);
    const lower = path.toLowerCase();
    if ([...paths].some((existing) => existing === lower || existing.startsWith(`${lower}/`) || lower.startsWith(`${existing}/`))) throw new Error(`Duplicate config path: ${template.path}`);
    paths.add(lower);
    files[path] = strToU8(template.content);
  }
  const archive = zipSync(files, { level: 6 });
  // Validate the actual ZIP, not just the inputs to the ZIP writer.
  const unpacked = unzipSync(archive);
  if (JSON.stringify(parse(strFromU8(unpacked["export.r2x"]))) !== JSON.stringify(manifest)) throw new Error("Archive manifest verification failed.");
  for (const [path, content] of Object.entries(files)) {
    if (path !== "export.r2x") configPath(path.slice(7));
    if (!unpacked[path] || unpacked[path].length !== content.length || content.some((byte, index) => unpacked[path][index] !== byte)) throw new Error(`Archive verification failed: ${path}`);
  }
  return archive;
}
