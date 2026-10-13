# Regal's Risk of Rain 2 Mods

A Next.js mod organizer with MongoDB persistence for modpacks, collections, tags, and reviews.

## Development

Run npm install, then npm run dev. The app runs at http://localhost:3001.
Use npm run lint and npm run build to validate changes.

## Database

Set MONGODB_URI in .env.local. Optional settings are MONGODB_DB (default: regals_ror2_mods) and MONGODB_WORKSPACE_ID (default: default).
Each modpack is a separate document in the modpacks collection, identified by workspaceId and id. It has its own name, color, notes, modIds, position, options, and timestamps. Collections and tags remain in the workspaces collection. IDs remain stable when a name changes and are encoded in URLs.
Legacy embedded workspaces.packs data migrates automatically on the first workspace read or save. The migration preserves the legacy array and saves the original workspace in workspace_migration_backups. It is safe to rerun and does not overwrite existing modpack documents. Removed modpacks are soft deleted so their future options remain recoverable.
To run the migration manually using .env, run npm run db:migrate-modpacks (requires Node.js 24). Use node scripts/test-modpack-migration.mjs to test migration behavior without touching MongoDB. An empty legacy packs array cannot recover missing modpacks; recovery requires another database, backup, or browser cache.
To import a legacy workspace API export, run `node --env-file=.env scripts/import-workspace.mjs <workspace.json>`. This saves a recovery backup, imports separate modpack documents, merges collections and tags, and verifies imported memberships. The production recovery export is saved in `production-workspace-recovery.json`.
The workspace API reports whether a saved workspace exists so an empty database can import the local workspace without discarding it. Loading an existing workspace does not trigger an unchanged save. If the database cannot be read, the app uses local storage and avoids automatically overwriting the database.
Thunderstore package data is cached in the browser; use the sync control in Filters to load or refresh it on another browser.

## Pages

- / displays the full mod library.
- /modpacks/[packId] displays one modpack, its notes, and its mods.
- /collections/[collectionId] displays one collection and its mods.

The left sidebar links between pages. Mods display as horizontal rows, with search and filter controls on the right. The shared workspace layout preserves state during navigation, including browser Back and Forward. Unknown modpack or collection IDs display a missing collection message rather than the full library.
