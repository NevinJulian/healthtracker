# src/db — Database Layer

This folder contains the entire SQLite persistence layer for the HealthTracker app. All data is stored locally on-device using **expo-sqlite**. There is no backend or remote API.

---

## Files

### `database.ts`

The single data-access module. **All screens and components import every query function and shared type from `database.ts`** — never directly from `schema.ts`. Keep that pattern: new queries and types go in `database.ts`.

#### Initialisation

```typescript
export async function initDatabase(): Promise<SQLite.SQLiteDatabase>
export function getDatabase(): SQLite.SQLiteDatabase
```

`initDatabase()` is called once from `App.tsx`, which blocks render until it resolves. It:
1. Opens (or creates) `healthtracker.db` via `expo-sqlite` with WAL journal mode
2. Detects and resets any incompatible legacy schema
3. Runs all pending migrations via `runMigrations()`
4. Seeds the Bio Force exercise library (`seedBioForceLibrary`) and recipe library (`seedRecipeLibrary`) — each guarded by a row-count check, not the migration list
5. Records `app_start_date` in `app_state` on first launch
6. Runs the first `syncRollingSchedule()` pass

`getDatabase()` returns the singleton `_db` after `initDatabase()` has completed.

#### Migrations — append-only, tracked in `schema_version`

Migrations are `{ version: number; sql: string }` objects in the `MIGRATIONS` array (defined in `schema.ts`) and applied by `runMigrations()`. Each applied version is recorded in a `schema_version` table; already-applied versions are skipped.

**To add a new migration:** append a new entry with the next integer `version` to `MIGRATIONS`. Never edit, reorder, or renumber existing entries — they have already run on users' devices.

The SQLite `user_version` PRAGMA is not used. There are no `migrateV<N>()` functions.

---

#### Key Exported Functions

| Function | Description |
|---|---|
| `initDatabase()` | One-time DB setup called from `App.tsx` |
| `getDatabase()` | Returns the open singleton |
| `syncRollingSchedule()` | Generates/updates `daily_log` rows for the rolling 7-day window. Called on every screen focus via `useFocusEffect`. |
| `getRollingWindow()` | Returns `DailyLogEntry[]` for the current 7-day window, sorted by date |
| `getTodayLog()` | Returns the `DailyLogEntry` for today |
| `updateCompletion(date, field, value)` | Toggles a completion flag (`walk_completed`, `hammer_completed`, `fasting_completed`) |
| `upsertExerciseCompleted(date, exerciseId, completed)` | Toggles a single exercise's `completed` flag in `daily_log.exercises` |
| `updateBodyWeight(date, weight)` | Saves body weight (kg) into `daily_log.body_weight` for the given date |
| `getAdditionalWorkouts(date)` | Returns bonus workouts logged for a given date |
| `addAdditionalWorkout(date, workout)` | Appends a bonus workout to a day's JSON array |
| `getWeeklyTemplate()` | Returns `WeeklyTemplateDay[]` — the 7 template rows |
| `updateTemplateDay(dayOfWeek, walk, hammer)` | Updates a day's task labels |
| `updateTemplateExercises(dayOfWeek, exercises)` | Replaces a day's exercises JSON |
| `getRecipes(category?)` | Returns recipes from `recipe_library`, optionally filtered by category |
| `getMealInventory()` | Returns meals in inventory with portions available |
| `logCookedMeal(recipeId, portions)` | Adds a cooked meal to `meal_inventory` and `cook_log` |
| `getShoppingListItems()` | Returns all shopping list items |
| `toggleShoppingListItem(id, checked)` | Toggles the checked state of a shopping item |
| `getCookingTasks()` | Returns pending cooking tasks joined with their recipe |
| `finishCooking(taskId, recipeId, servings)` | Marks a task done and adds servings to `meal_inventory` |
| `assignMealToPlan(date, mealType, recipeId)` | Assigns a meal to `weekly_meal_plan` |
| `toggleMealConsumed(id, consumed)` | Marks a meal consumed and decrements `meal_inventory` |

---

#### Rolling Window Architecture

The 7-day rolling window is the core domain model:

```
[7 days ago] ... [yesterday] [TODAY] [tomorrow] ... [+7 days]
```

`weekly_template` holds exactly 7 rows — one per `day_of_week` (0 = Sunday). `daily_log` is date-keyed (`YYYY-MM-DD`).

`syncRollingSchedule()` runs at startup and on every screen focus:
1. For each date in the forward window, insert a missing `daily_log` row from the matching `weekly_template` row
2. Backfill `exercises` into existing rows that have an empty array but the template now has exercises
3. Compute the **21-day weight progression** for `hammer_task` via `buildHammerTask()` — every 21 days the suffix advances by 5 kg (e.g. `@ Baseline`, `@ Baseline + 5kg`)
4. Prune `daily_log` rows older than the history cutoff

Past rows that already have completion data are never regenerated.

#### Body weight

Body weight is stored as a `body_weight REAL` column on `daily_log` (added in migration v20). There is no separate `weight_log` table.

Per-day JSON state (`exercises`, `additional_workouts`) is parsed defensively — `parseExercises()` returns `[]` on any malformed input.

---

### `schema.ts`

Holds all DDL constants, seed SQL strings, exercise seed data arrays, and the ordered `MIGRATIONS` array. Exports the `Exercise` interface and `Migration` interface. `database.ts` re-exports `Exercise` so screens only ever import from `database.ts`.

**Tables defined across migrations:**
- `schema_version` — migration tracking (version integers)
- `app_state` — key-value store (e.g. `app_start_date`)
- `weekly_template` — 7 base rows, one per weekday
- `daily_log` — rolling day-by-day log, date-keyed, pruned to +/-7 days
- `bio_force_library` — exercise reference library
- `recipe_library` — full recipe catalogue
- `shopping_list` — auto-aggregated shopping items
- `meal_inventory` — cooked meals with portions available
- `weekly_meal_plan` — assigned meals per day/slot
- `cooking_tasks` — queue of meals to cook next
- `off_cache` — Open Food Facts ingredient cache
- `cook_log` — persistent record of every cook event

---

## Data Flow

```
weekly_template
    |
    v  (syncRollingSchedule)
daily_log ──────────────────> DashboardScreen / OverviewScreen
    |
    └── completion flags ───> AnalyticsDashboardScreen

src/data/recipes.ts (static seed)
    |
    v  (seedRecipeLibrary)
recipe_library
    |
    |──> RecipesScreen / RecipeDetailScreen
    |──> shopping_list  (addToShoppingList)
    └──> cooking_tasks  (addCookingTask)
              |
              v  (finishCooking)
         meal_inventory
         cook_log
              |
              v  (assignMealToPlan)
         weekly_meal_plan
```
