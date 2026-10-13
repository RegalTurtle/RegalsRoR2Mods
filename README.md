# Regal's Risk of Rain 2 Mods

A Next.js mod organizer with MongoDB persistence for modpacks, collections, tags, and reviews.

## Development

Run npm install, then npm run dev. The app runs at http://localhost:3001.
Use npm run lint and npm run build to validate changes.

## Database

Set MONGODB_URI in .env.local. Optional settings are MONGODB_DB (default: regals_ror2_mods) and MONGODB_WORKSPACE_ID (default: default).
Modpacks and collections retain their existing IDs and membership lists in the workspaces collection. No database migration is required for the new routes. IDs remain stable when a name changes and are encoded in URLs.
The workspace API reports whether a saved workspace exists so an empty database can import the local workspace without discarding it. If the database cannot be read, the app uses local storage and avoids automatically overwriting the database.
Thunderstore package data is cached in the browser; use the sync control in Filters to load or refresh it on another browser.

## Pages

- / displays the full mod library.
- /modpacks/[packId] displays one modpack, its notes, and its mods.
- /collections/[collectionId] displays one collection and its mods.

The left sidebar links between pages. Mods display as horizontal rows, with search and filter controls on the right. The shared workspace layout preserves state during navigation, including browser Back and Forward. Unknown modpack or collection IDs display a missing collection message rather than the full library.
