# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HealthTracker — an Expo / React Native (SDK 57, RN 0.86, React 19, TypeScript strict) fitness + meal-prep app. All data is on-device in SQLite via `expo-sqlite`. No backend; the only network calls are keyless recipe lookups in `src/api` (TheMealDB, Open Food Facts). New Architecture is on.

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

- `initDatabase()` (called once from `App.tsx`, which blocks render until it resolves; if startup throws it shows `RecoveryScreen`, a "Save data" (`src/services/rescueExport.ts`) screen, with Retry unless the failure was font loading) opens the DB, rejects one whose `daily_log` has no `date` column (`assertCompatibleSchema` throws; nothing is deleted), runs migrations, seeds libraries, records the start date, and runs the first rolling-schedule sync. `getDatabase()` returns the singleton afterward.
- `src/db/schema.ts` holds all DDL, seed SQL, and the ordered `MIGRATIONS` array.

### Migrations: append-only, integer-versioned, tracked in a table
Migrations are `{ version: number, sql: string }` objects in `MIGRATIONS` (schema.ts), applied in order by `runMigrations()` and recorded in the `schema_version` table — **not** the SQLite `user_version` PRAGMA.

To change the schema: **append a new entry with the next integer `version`.** Never edit, reorder, or renumber existing entries — they have already run on users' devices and are skipped via `schema_version`. Seeds are themselves migrations and must be idempotent (`INSERT OR IGNORE`, or `UPDATE ... WHERE ... AND exercises = '[]'`). Bulk library seeds (`bio_force_library`, `recipe_library`) are seeded separately by `seedBioForceLibrary` / `seedRecipeLibrary`, which are guarded by a row-count check rather than the migration list.

### The 7-day rolling window (the core domain model)
`weekly_template` has exactly 7 rows (one per `day_of_week`, 0=Sun). `daily_log` is date-keyed (`YYYY-MM-DD`). `syncRollingSchedule()` runs at startup **and on every screen focus** (via `useFocusEffect`); it inserts missing `daily_log` rows from today − up to 90 days back (capped at the app's start date) through today + 7 days, and backfills empty `exercises` on existing rows only within today − 7 through today + 7 (the pre-#301 window; older rows are never retro-filled). History is retained indefinitely — old rows are never deleted (#300). Existing rows with completion data are never regenerated. Gym weight auto-progresses on a 21-day cycle (`buildHammerTask`, `CYCLE_DAYS`/`KG_PER_CYCLE`). Per-day mutable state that isn't a column (`exercises`, `additional_workouts`) is stored as JSON text and parsed defensively on read (`parseExercises` returns `[]` on any malformed input — preserve that). Writers are strict: they refuse a malformed stored value with `CorruptJsonError` rather than overwrite it, and the Dashboard's "Reset this day" (`resetCorruptDayColumn`) keeps the raw text in `app_state` before writing a fresh value.

### Meal-prep pipeline (data flow)
`src/data/recipes.ts` (static seed) → `recipe_library` → user adds a recipe → `shopping_list` + `cooking_tasks` → `finishCooking()` → `meal_inventory` → `assignMealToPlan()` → `weekly_meal_plan`; `toggleMealConsumed()` decrements inventory. Cross-table inventory mutations use `db.withTransactionAsync` — keep new multi-step inventory changes transactional.

### Navigation & theme
`src/navigation/AppNavigator.tsx` is a **right-side** drawer; the hamburger is rendered as `headerRight` (default left icon suppressed). Two nested stacks sit inside the drawer: "Recipes" (`RecipesMain` → `RecipeDetail`, `RecipeEditor`) and "Discover" (`DiscoverMain` → `DiscoverDetail`). `src/theme/tokens.ts` (the "Verdure" palette) is the single source of truth for `Colors`/`Spacing`/`Typography`/`Radius` — use these tokens, never raw hex or magic numbers. Screens should not add top padding; the navigation header owns it. `App.tsx` wraps the navigator in `AppErrorBoundary`, which shows `RecoveryScreen` (with Retry) when a render throws. `DashboardScreen` and `AnalyticsDashboardScreen` show `LoadErrorView` (`src/components`) for a failed load: full screen with Retry when nothing has loaded, a banner over the last loaded data when a refresh fails.

## Testing setup — read before touching jest config

`jest.config.js` and `__mocks__/` are a **deliberate workaround**, not boilerplate. `testEnvironment` is forced to `node` and `moduleNameMapper` stubs `expo-sqlite`, `expo-asset`, `@expo/vector-icons`, `expo-notifications`, `expo-sharing`, `expo-document-picker`, `expo-file-system` and `expo-file-system/legacy`, which need native modules that do not exist under node, and `expo/src/winter`, so jest-expo's setup does not install the winter runtime (that stub was added when dynamic `import()` in the runtime was blocked under Jest 30; whether it is still needed on Jest 29.7 has not been verified across the suite, so check before removing it). The mocks live in `__mocks__/` (`expo-sqlite.js`, `expo-asset.js`, `expo-winter.js`, `expo-notifications.js`, `expo-sharing.js`, `expo-document-picker.js`, `expo-file-system.js`, `expo-file-system/legacy.js`, `@expo/vector-icons.js`). Don't "simplify" the jest config or these mocks without understanding why they exist — several recent commits exist solely to fix this.

Note: there is no `setupFiles` entry in `jest.config.js`; the active mocks are the `__mocks__/` ones referenced by `moduleNameMapper`, with one exception: `moduleNameMapper` still maps `expo-file-system/legacy`, but jest-expo's own mock wins for that module id, so `__mocks__/expo-file-system/legacy.js` is never used. (A dead, unwired `src/test/setup.ts` used to sit alongside this — deleted in #336, not fixed, since nothing imported it.) `src/db/__tests__/` suites drive a real sql.js SQLite engine through `src/db/testHelpers/sqljsExpoAdapter.ts`; `src/__tests__/App.startFailure.test.tsx`, `src/__tests__/App.renderCrash.test.tsx` and the `DashboardScreen*`, `AnalyticsDashboardScreen*`, `SettingsScreen*`, `MealPrepScreen*`, `DiscoverScreen*`, `DiscoverDetailScreen*`, `OnboardingScreen.confirm|skip` and `RecipeEditorScreen.abort|overlap|saveDeadline` suites render the real screens with `@testing-library/react-native` (which throws on import unless `react-test-renderer` is pinned to exactly the `react` version, so bump both together, #360) against a mocked `../../db/database` (`DiscoverScreen.test.tsx` mocks `../../api/mealdb` instead, and `AnalyticsDashboardScreen.liftingSelection|memoisation` render exported cards only); `OnboardingScreen.test.tsx` and `RecipeEditorScreen.test.tsx` are still smoke-level.

## Gotchas

- **`react-native-reanimated` 4.x must stay paired with `react-native-worklets`.** Keep both at the versions Expo SDK 57 / RN 0.86 supports. The worklets Babel plugin comes through `babel-preset-expo`, so keep it a dependency and keep it as the preset in `babel.config.js`. Do not restore reanimated 3.16.7 (it does not compile on current RN) or remove worklets. Native breakage is caught only by `build-check.yml` / the EAS build, not by `npm test` or `npm run typecheck`.
- `npm install` / `npm ci` require `--legacy-peer-deps`.

## CI & releases

- `.github/workflows/test.yml` — runs `npm run typecheck` then `npm test` on PRs to `main` and on pushes to non-`main` branches.
- `.github/workflows/build-check.yml` — verifies the Android APK actually compiles (the JS-only merge gate can't catch native/Gradle breakage). Runs on PRs to `main` that touch `package.json`, `package-lock.json`, `app.json`, `eas.json`, `babel.config.js`, or the workflow file itself, plus on-demand via `workflow_dispatch`; builds the APK locally through EAS (`eas build -p android --profile preview --local`) without publishing a release.
- `.github/workflows/release.yml` — on push to `main`, builds the APK locally via EAS and publishes a GitHub Release tagged `v<run_number>` with a download link + QR code.

## Contribution conventions

Atomic commits referencing a GitHub issue number, e.g. `fix: resolve drawer overlap (#105)`. Branch from `main`, open a PR, and **merge with a regular merge commit — never squash**, so each branch's individual commits are preserved on `main` (keeping that granular history is the whole point of committing in small steps). (`CLAUDE_CODE_SETUP.md` documents the GitHub-MCP-driven workflow and the in-progress "Verdure" redesign under `design/`.)

Comments only where the code can't explain itself. No issue numbers, no history of how the code got here, no explanation of why a line exists, that goes in the commit message. In lines you touch anyway, trim existing comments to the same standard.
