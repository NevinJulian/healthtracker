# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HealthTracker — an Expo / React Native (SDK 54, RN 0.81, React 19, TypeScript strict) fitness + meal-prep app. All data is on-device in SQLite via `expo-sqlite`. No backend, no remote API. New Architecture is enabled (`app.json` → `newArchEnabled: true`).

## Commands

```powershell
npm install --legacy-peer-deps   # peer deps DON'T resolve without this flag (CI uses npm ci --legacy-peer-deps)
npx expo start -c                # dev server, -c clears the Metro cache (use when things behave oddly)
npm run typecheck                # tsc --noEmit — this is the ONLY static check; there is no ESLint/Prettier
npm test                         # jest
npm test -- DashboardScreen      # run a single test file by name pattern
npm run build:apk                # EAS cloud build, downloadable APK (preview profile)
npm run build:android-bundle     # EAS production AAB
```

Before saying a change is done, run `npm run typecheck` and `npm test`. There is no lint step to run.

## Architecture

### Database is the spine — and it's one file
`src/db/database.ts` is the single data-access module. **Screens and components import every query function AND every shared type from `database.ts`** (e.g. `Exercise` is defined in `schema.ts` but re-exported from `database.ts` so callers only ever import from one place). Keep that pattern: new queries/types go in `database.ts`.

- `initDatabase()` (called once from `App.tsx`, which blocks render until it resolves) opens the DB, runs migrations, seeds libraries, records the start date, and runs the first rolling-schedule sync. `getDatabase()` returns the singleton afterward.
- `src/db/schema.ts` holds all DDL, seed SQL, and the ordered `MIGRATIONS` array.

### Migrations: append-only, integer-versioned, tracked in a table
Migrations are `{ version: number, sql: string }` objects in `MIGRATIONS` (schema.ts), applied in order by `runMigrations()` and recorded in the `schema_version` table — **not** the SQLite `user_version` PRAGMA.

To change the schema: **append a new entry with the next integer `version`.** Never edit, reorder, or renumber existing entries — they have already run on users' devices and are skipped via `schema_version`. Seeds are themselves migrations and must be idempotent (`INSERT OR IGNORE`, or `UPDATE ... WHERE ... AND exercises = '[]'`). Bulk library seeds (`bio_force_library`, `recipe_library`) are seeded separately by `seedBioForceLibrary` / `seedRecipeLibrary`, which are guarded by a row-count check rather than the migration list.

### The 7-day rolling window (the core domain model)
`weekly_template` has exactly 7 rows (one per `day_of_week`, 0=Sun). `daily_log` is date-keyed (`YYYY-MM-DD`). `syncRollingSchedule()` runs at startup **and on every screen focus** (via `useFocusEffect`); it generates missing `daily_log` rows for the window (today ± 7 days), backfills empty `exercises`, and prunes rows older than the cutoff. Existing rows with completion data are never regenerated. Gym weight auto-progresses on a 21-day cycle (`buildHammerTask`, `CYCLE_DAYS`/`KG_PER_CYCLE`). Per-day mutable state that isn't a column (`exercises`, `additional_workouts`) is stored as JSON text and parsed defensively (`parseExercises` returns `[]` on any malformed input — preserve that).

### Meal-prep pipeline (data flow)
`src/data/recipes.ts` (static seed) → `recipe_library` → user adds a recipe → `shopping_list` + `cooking_tasks` → `finishCooking()` → `meal_inventory` → `assignMealToPlan()` → `weekly_meal_plan`; `toggleMealConsumed()` decrements inventory. Cross-table inventory mutations use `db.withTransactionAsync` — keep new multi-step inventory changes transactional.

### Navigation & theme
`src/navigation/AppNavigator.tsx` is a **right-side** drawer; the hamburger is rendered as `headerRight` (default left icon suppressed). "Recipes" is a nested stack (`RecipesMain` → `RecipeDetail`) inside the drawer. `src/theme/tokens.ts` (the "Verdure" palette) is the single source of truth for `Colors`/`Spacing`/`Typography`/`Radius` — use these tokens, never raw hex or magic numbers. Screens should not add top padding; the navigation header owns it.

## Testing setup — read before touching jest config

`jest.config.js` and `__mocks__/` are a **deliberate workaround**, not boilerplate. `testEnvironment` is forced to `node` and `moduleNameMapper` stubs `expo/src/winter`, `expo-sqlite`, and `expo-asset` to dodge a Jest 30 + jest-expo "winter runtime" incompatibility (it uses dynamic `import()`, which Jest 30 blocks). The native-module mocks live in `__mocks__/` (`expo-sqlite.js`, `expo-asset.js`, `expo-winter.js`). Don't "simplify" the jest config or these mocks without understanding why they exist — several recent commits exist solely to fix this.

Note: `src/test/setup.ts` is **not** wired into `jest.config.js` (there is no `setupFiles`); the active mocks are the `__mocks__/` ones referenced by `moduleNameMapper`. Existing tests are smoke-level (e.g. "the screen export is a function") — they do not render DB-backed screens.

## Gotchas

- **`react-native-reanimated` is pinned to 3.16.7 and worklets were removed** to fix a TurboModule crash under the New Architecture (#219–221). Be very cautious upgrading reanimated or reintroducing worklets.
- **The per-folder `README.md` files under `src/` are partially stale.** `src/db/README.md` and `schema.ts`'s header describe an `openDb()` function, a `user_version` PRAGMA migration scheme, `migrateV<N>()` functions, and a `weight_log` table — **none of these exist**. The real code uses `initDatabase()`, a `schema_version` table + `MIGRATIONS` array, and stores weight as a `body_weight` column on `daily_log`. Trust the code over those READMEs.
- `npm install` / `npm ci` require `--legacy-peer-deps`.

## CI & releases

- `.github/workflows/test.yml` — runs `npm test` on PRs to `main` and on pushes to non-`main` branches.
- `.github/workflows/release.yml` — on push to `main`, builds the APK locally via EAS and publishes a GitHub Release tagged `v<run_number>` with a download link + QR code.

## Contribution conventions

Atomic commits referencing a GitHub issue number, e.g. `fix: resolve drawer overlap (#105)`. Branch from `main`, open a PR, and **merge with a regular merge commit — never squash**, so each branch's individual commits are preserved on `main` (keeping that granular history is the whole point of committing in small steps). (`CLAUDE_CODE_SETUP.md` documents the GitHub-MCP-driven workflow and the in-progress "Verdure" redesign under `design/`.)
