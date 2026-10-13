import assert from "node:assert/strict";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { parse } from "yaml";
import { resolveProfile, buildProfileArchive, configPath } from "../lib/profile-export.ts";

const catalog = [
  { full_name: "Team-Mod", versions: [{ version_number: "1.2.3", dependencies: ["Team-Library-2.0.0"] }] },
  { full_name: "Team-Library", versions: [{ version_number: "2.0.0", dependencies: ["Team-Core-1.0.0"] }, { version_number: "1.0.0", dependencies: [] }] },
  { full_name: "Team-Core", versions: [{ version_number: "1.0.0", dependencies: [] }] },
  { full_name: "Team-Other", versions: [{ version_number: "1.0.0", dependencies: ["Team-Library-1.0.0"] }] },
];
const mods = resolveProfile(["Team-Mod", "Team-Mod"], catalog);
assert.deepEqual(mods.map((mod) => mod.name), ["Team-Core", "Team-Library", "Team-Mod"]);
const content = '\ufeff# Original comment\r\n[Settings]\r\nEnabled = true\r\nUntouched = 42\r\n';
const template = { modId: "Team-Mod", supportedVersions: ["1.2.3"], path: "nested/Team.Mod.cfg", content };
const archive = buildProfileArchive("Test Profile", mods, [template, { ...template, modId: "Not-Selected", path: "excluded.cfg" }]);
const files = unzipSync(archive);
assert.deepEqual(Object.keys(files).sort(), ["config/nested/Team.Mod.cfg", "export.r2x"]);
assert.deepEqual(Buffer.from(files['config/nested/Team.Mod.cfg']), Buffer.from(content, 'utf8'));
assert.deepEqual(parse(strFromU8(files['export.r2x'])), { profileName: "Test Profile", mods });
assert.throws(() => buildProfileArchive("../Bad", mods), /profile name/);
for (const path of ['../escape.cfg', 'C:/bad.cfg', '/root.cfg', 'nested\\bad.cfg', 'plugin.dll', 'CON.cfg', 'nested/../bad.cfg']) assert.throws(() => configPath(path));
assert.throws(() => buildProfileArchive("Test", mods, [template, template]), /exactly one/);
assert.throws(() => buildProfileArchive("Test", mods, [{ ...template, supportedVersions: ['0.0.1'] }]), /supporting/);
assert.throws(() => buildProfileArchive("Test", mods, [template, { ...template, modId: "Team-Core", supportedVersions: ["1.0.0"], path: template.path.toUpperCase() }]), /Duplicate/);
buildProfileArchive("Test", mods, [template, { ...template, supportedVersions: ['0.0.1'] }]);
const cycle = [{ full_name: 'A-Mod', versions: [{version_number:'1.0.0', dependencies:['B-Mod-1.0.0']}] }, {full_name:'B-Mod',versions:[{version_number:'1.0.0',dependencies:['A-Mod-1.0.0']}]}];
assert.equal(resolveProfile(['A-Mod'], cycle).length, 2);
fs.mkdirSync('artifacts', {recursive:true});
fs.writeFileSync('artifacts/profile-export-test.r2z', archive);
console.log('Passed dependency resolution, conflicts, missing versions, cycles, YAML round trip, ZIP paths, versioned templates, and exact config preservation. Test archive: artifacts/profile-export-test.r2z');

assert.throws(() => resolveProfile(["Missing-Mod"], catalog), /Unavailable/);
assert.throws(() => resolveProfile([], catalog), /no mods/);
assert.equal(resolveProfile(["Team-Mod", "Team-Other"], catalog).length, 4);
const unavailable = structuredClone(catalog); unavailable[1].versions[0].is_active = false;
assert.throws(() => resolveProfile(["Team-Mod"], unavailable), /conflict/);
const unordered = [{full_name:"Latest-Mod", versions:[{version_number:"1.9.0",dependencies:[]},{version_number:"1.10.0",dependencies:[]},{version_number:"9.0.0",dependencies:[],is_active:false}]}];
assert.equal(resolveProfile(["Latest-Mod"], unordered)[0].version.minor, 10);

const universalFiles = unzipSync(buildProfileArchive("Test", mods, [{ ...template, supportedVersions: [], sourceVersion: "0.0.1", appliesToAllVersions: true }]));
assert.deepEqual(Buffer.from(universalFiles["config/nested/Team.Mod.cfg"]), Buffer.from(content, "utf8"));
console.log("Passed config reuse across mod versions.");
