# Regal's Risk of Rain 2 Mods

A Next.js mod organizer with MongoDB persistence for modpacks, collections, tags, and reviews.

## Development

Run npm install, then npm run dev. The app runs at http://localhost:3001.
Use npm run lint and npm run build to validate changes.

## Login and owner-created accounts

The website requires a username/password login at `/login`. There is no public registration. Create accounts from an interactive terminal with the same `.env` database settings as the deployed website:

```sh
npm run user:create -- regal
```

The command prompts privately for a password and confirmation (12–1024 characters). It stores a salted scrypt hash in the `users` collection and refuses to overwrite an existing username. Usernames are case insensitive and accept letters, numbers, underscores, and hyphens. No default credentials are supplied.

For a fresh database, create the initial administrator with `npm run user:create -- regal --admin`. The existing `regal` account has been promoted to administrator. Other CLI-created accounts default to members with no selected modpacks or collections.

Administrators can use **Manage users** in the header or `/admin/users` to create and delete member accounts and save their visible modpacks and collections. Permissions default to none; select individual items or allow all (including future items). Administrator accounts have full access and are protected from deletion or permission changes on this page. Deleting an account revokes its sessions. Members can edit mods, notes, and configs in permitted modpacks and export them. Config copying/importing requires access to both source and destination. Pack creation/deletion, collection changes, shared tags/reviews, and user management remain administrator-only. Member workspace saves update only permitted existing pack documents and never delete omitted packs or overwrite collections/tags. Both pages and APIs enforce visibility. Browser caches are separated by username, and members do not restore cached private workspace data.

Run `node --env-file=.env scripts/test-user-access.mjs` against a server on port 3002 to test account management, visibility restrictions, and revocation. Temporary test accounts and sessions are removed afterward.

All users, including administrators, can open **Account** in the header or `/account` to change their own username and password. Every change requires the current password. Leave the new-password fields blank to change only the username. Usernames remain case insensitive and unique within the workspace; new passwords require at least 12 characters. Account IDs, roles, modpack access, and collection access remain unchanged. Password changes revoke other sessions and rotate the current session. Run `node --env-file=.env scripts/test-account.mjs` against port 3002 to test both member and admin account changes.

Sessions use random tokens in HttpOnly, SameSite cookies (Secure in production), with hashed tokens stored in `auth_sessions`. Sessions expire after seven days. Log out revokes the session in MongoDB. Disabling a user's database document (`disabled: true`) immediately rejects their sessions. Login attempts are limited per username within fifteen-minute windows. Mutating APIs enforce same-origin requests; all workspace, review, and config APIs validate sessions. Accounts use the existing workspace with per-account modpack and collection permissions.

Deploy behind HTTPS so production session cookies work. Start a local production server on port 3002 after building, then run `node --env-file=.env scripts/test-auth.mjs` to exercise login, logout, session validation, origin checks, and protected routes. The test creates and removes its own temporary account and session.

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

## r2modman profile downloads

Each modpack page exports all mods in that modpack plus their recursive dependencies. There are no visitor selection or version-curation controls. Validation and download fetch current Thunderstore metadata and select the highest active semantic version of every package, including dependencies. Older saved curated versions are ignored. Every manifest entry still contains an exact resolved version. Dependency references are checked as minimum versions; export fails if the latest active version cannot meet a requirement. Saved configs apply to all mod versions until replaced. Static version-specific templates must support the resolved latest versions.

Visitors validate the profile, then download an `.r2z` named after the modpack.

The ZIP is generated entirely in the browser with fflate and YAML. It contains root `export.r2x` and applicable files beneath `config/`, with no mod binaries. In r2modman, choose **Import profile → From file**. No Thunderstore modpack publication is needed.

Expand **Configuration** under any mod row. Enter the original filename (including any relative subfolders), the mod version the config came from, and paste the full config text. Save config to store it directly inside the modpack document as `configs[modId]`. Each mod has one config, loaded automatically when its Config panel opens. Saving replaces that mod?s config, including its filename. Legacy `mod_configs` records migrate automatically; old records remain as a backup. BepInEx section/key files generate controls grouped by section; Boolean and Acceptable values metadata generate dropdowns. Other file formats can be preserved and edited as raw text.

Configuration panels are available on modpack pages and saves are specific to that pack. The latest saved config for each file is used for all mod versions until replaced; sourceVersion is informational. Existing saved configs also follow this behavior. Saving settings replaces only edited values; comments, sections, untouched values, and existing line endings are preserved. The original imported text is retained in the database. Exports fetch configs afresh and include only files associated with resolved mods. Conflicting paths block export. Static templates can still be registered in `lib/config-templates.ts`.

Run `node scripts/test-mod-config.mjs` to test config parsing and preservation.

Format references: [r2modman exporter](https://github.com/ebkr/r2modmanPlus/blob/develop/src/r2mm/mods/ProfileModList.ts), [manifest parsing and config import](https://github.com/ebkr/r2modmanPlus/blob/develop/src/utils/ProfileUtils.ts), and [export mod fields](https://github.com/ebkr/r2modmanPlus/blob/develop/src/model/exports/ExportMod.ts).

Run `npm run test:profile-export` to check dependency resolution, conflicts, unavailable versions, cycles, ZIP paths, YAML parsing, template version matching, and exact config preservation. The generated `artifacts/profile-export-test.r2z` uses synthetic packages and is only an automated test fixture. An actual fresh-profile r2modman import has not been tested; installation and config arrival still require desktop verification.

## Comparing configs

Expand a mod?s Config panel, click Compare with, select another modpack, and click Compare saved configs. Both configs are fetched from storage. The unified diff shows red minus lines for the current modpack and green plus lines for the selected modpack, with context and source-version headers. CRLF/LF differences can be ignored. Unsaved editor changes are excluded.
