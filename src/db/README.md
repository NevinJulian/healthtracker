# src/db — Database Layer

This folder contains the entire SQLite persistence layer for the HealthTracker app. All data is stored locally on-device using **expo-sqlite**.

---

## Files

### `database.ts`

The main database module. Exports all query functions and the initialization logic.

#### Initialization & Migrations

The database uses a **versioned migration system**:

```typescript
export async function openDb(): Promise<SQLiteDatabase>
```

On first call, `openDb()`:
1. Opens (or creates) `healthtracker.db` via `expo-sqlite`
2. Reads the current `user_version` PRAGMA
3. Applies any pending migration functions (`v1`, `v2`, … `v27` and beyond) in order
4. Each migration is idempotent — safe to run on an existing DB

**Adding a new migration:**
- Increment `LATEST_VERSION` at the top of `database.ts`
- Add a new `async function migrateV<N>(db)` function
- Register it in the `MIGRATIONS` array

---

#### Key Exported Functions

| Function | Description |
|---|---|
| `syncRollingSchedule()` | Generates/updates `daily_logs` for the rolling 7-day window (past 3 + today + future 3 days). Called on every screen focus. |
| `getRollingWindow()` | Returns `DailyLogEntry[]` for the current 7-day window, sorted by date |
| `getTodayLog()` | Returns the `DailyLogEntry` for today specifically |
| `updateCompletion(date, field, value)` | Toggles a completion flag (`walk_completed`, `hammer_completed`, `fasting_completed`) |
| `getAdditionalWorkouts(date)` | Returns bonus workouts logged for a given date |
| `addAdditionalWorkout(date, workout)` | Appends a bonus workout to a day's JSON array |
| `getWeightHistory(days)` | Returns weight log entries for the last N days |
| `logWeight(weight)` | Saves a new weight entry |
| `getWeeklyTemplate()` | Returns `WeeklyTemplateDay[]` — the 7 template rows |
| `updateTemplateDay(dayOfWeek, walk, hammer)` | Updates a day's task labels |
| `updateTemplateExercises(dayOfWeek, exercises)` | Updates a day's exercises JSON |
| `getRecipes(category?)` | Returns recipes, optionally filtered by category |
| `getMealInventory()` | Returns meals in the cooked inventory with portions available |
| `logCookedMeal(recipeId, portions)` | Adds a cooked meal to inventory |
| `getShoppingListItems()` | Returns all shopping list items |
| `toggleShoppingListItem(id, checked)` | Toggles the checked state of a shopping item |
| `getCookingTasks()` | Returns all pending cooking tasks with their recipe |
| `finishCooking(taskId, recipeId, servings)` | Marks a task done, adds servings to inventory |

---

#### Rolling Window Architecture

The 7-day rolling window is a perpetual schedule that never ends:

```
[3 days ago] [2 days ago] [yesterday] [TODAY] [tomorrow] [+2 days] [+3 days]
```

`syncRollingSchedule()` does the following on each call:
1. For each date in the 7-day window, check if a `daily_logs` row exists
2. If not, look up that date's `day_of_week` in `weekly_template` and generate the row
3. Apply the **21-day weight progression**: every 21 days, the `hammer_task` gets a heavier weight suffix appended (e.g. `@ Baseline`, `@ Baseline + 2.5kg`, etc.)
4. Past days are never regenerated if they already have completion data

---

### `schema.ts`

Contains the SQL `CREATE TABLE` statements used as the initial schema seed. These are applied by the earliest migrations (`migrateV1`, `migrateV2`, etc.).

**Tables defined:**
- `weekly_template` — 7-day workout schedule base
- `daily_logs` — rolling window day-by-day log
- `weight_log` — timestamped weight entries
- `recipes` — full recipe library (seeded from `src/data/recipes.ts`)
- `meal_inventory` — cooked meals currently available
- `weekly_meal_plan` — assigned meals per day/slot
- `shopping_list` — auto-aggregated shopping items
- `cooking_tasks` — queued meals to cook next

---

## Data Flow

```
weekly_template
    │
    ▼  (syncRollingSchedule)
daily_logs ──────────────► DashboardScreen / OverviewScreen
    │
    └── completion flags ─► AnalyticsDashboardScreen

recipes (src/data/recipes.ts)
    │
    ▼  (seed migration)
SQLite recipes table
    │
    ├──► RecipesScreen / RecipeDetailScreen
    ├──► shopping_list (addToShoppingList)
    └──► cooking_tasks (addCookingTask)
              │
              ▼  (finishCooking)
         meal_inventory
              │
              ▼  (assignMealToPlan)
         weekly_meal_plan
```
