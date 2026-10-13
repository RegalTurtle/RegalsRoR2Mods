import assert from "node:assert/strict";
import { migrateModpacks, readModpacks, saveModpacks } from "../lib/modpacks.ts";

// Exercise migration and round-trip saves without touching the user's database.
function memoryDb(seed) {
  const tables = { workspaces: structuredClone(seed) };
  function matches(doc, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === "object") {
        if ("$exists" in value) return (key in doc) === value.$exists;
        if ("$nin" in value) return !value.$nin.includes(doc[key]);
      }
      return doc[key] === value;
    });
  }
  return {
    tables,
    collection(name) {
      const docs = tables[name] ??= [];
      const apply = (doc, update, insert) => {
        Object.assign(doc, structuredClone(insert ? update.$setOnInsert ?? {} : {}), structuredClone(update.$set ?? {}));
        for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
      };
      return {
        async createIndex() {},
        async findOne(filter) { return structuredClone(docs.find((doc) => matches(doc, filter)) ?? null); },
        async updateOne(filter, update, options = {}) {
          let doc = docs.find((doc) => matches(doc, filter));
          const insert = !doc;
          if (!doc && options.upsert) { doc = { ...filter }; docs.push(doc); }
          if (doc) apply(doc, update, insert);
        },
        async updateMany(filter, update) { for (const doc of docs.filter((doc) => matches(doc, filter))) apply(doc, update, false); },
        find(filter) {
          return { sort() { return { async toArray() {
            return structuredClone(docs.filter((doc) => matches(doc, filter)).sort((a, b) => a.position - b.position));
          } }; } };
        },
      };
    },
  };
}

const pack = { id: "eclipse", name: "Eclipse", color: "#00a6a6", notes: "Keep these notes", modIds: ["Moffein-TeleExpansion"] };
const db = memoryDb([{ workspaceId: "default", packs: [pack], groups: [], tags: {} }]);
await migrateModpacks(db, "default");
assert.equal(db.tables.modpacks.length, 1);
assert.deepEqual(db.tables.modpacks[0].modIds, pack.modIds);
assert.equal(db.tables.modpacks[0].notes, pack.notes);
assert.deepEqual(db.tables.workspace_migration_backups[0].workspace.packs, [pack]);
db.tables.modpacks[0].options = { difficulty: "eclipse" };
await migrateModpacks(db, "default");
assert.equal(db.tables.modpacks.length, 1);
await saveModpacks(db, "default", [{ ...pack, name: "Renamed" }]);
assert.deepEqual(db.tables.modpacks[0].options, { difficulty: "eclipse" });
assert.equal((await readModpacks(db, "default"))[0].name, "Renamed");
await saveModpacks(db, "default", []);
assert.equal((await readModpacks(db, "default")).length, 0);
assert.ok(db.tables.modpacks[0].deletedAt);
assert.deepEqual(db.tables.workspaces[0].packs, [pack]);
await saveModpacks(db, "default", [pack]);
assert.equal((await readModpacks(db, "default")).length, 1);
assert.deepEqual(db.tables.modpacks[0].options, { difficulty: "eclipse" });
const invalid = memoryDb([{ workspaceId: "default", packs: [{ id: "broken" }] }]);
await assert.rejects(migrateModpacks(invalid, "default"), /invalid/);
assert.equal(invalid.tables.workspaces[0].modpacksSchemaVersion, undefined);
console.log("Passed: legacy migration, backup, idempotency, options preservation, soft deletion, recovery, invalid legacy data.");
