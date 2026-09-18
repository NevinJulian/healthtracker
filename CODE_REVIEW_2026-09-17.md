# HealthTracker — Code Review, 2026-09-17

> **Every finding below is now a GitHub issue: #300–#357.** Index at the bottom of this file.

State at review: `main` @ `b5791a5`, v1.1.0, 33 migrations, 26k LOC in `src/`.
`npm run typecheck` clean. `npm test` green — 17 suites, 331 tests.

Everything below was verified by reading the code. Line numbers are from `main` @ `b5791a5`.

---

## Verdict

The app is not almost finished. It is feature-complete and broken at the data layer.

There is one bug that deletes the user's history every time the app launches, and the entire
analytics half of the app is built on top of it. Three more bugs silently corrupt the meal
inventory during normal use. Fix those five before adding a single feature.

Priority order: **P0 data loss → P1 correctness → repo hygiene → features**.

---

## P0 — Data loss

### 1. `syncRollingSchedule()` permanently deletes all history older than 7 days

`src/db/database.ts:114,344,417`

```js
const DAYS_HISTORY = 7;
const cutoffISO = _addDaysKey(todayISO, -DAYS_HISTORY);
await db.runAsync('DELETE FROM daily_log WHERE date < ?', [cutoffISO]);
```

Unconditional. Runs on every launch (`database.ts:450`) and on every focus of Dashboard
(`:305`) and Overview (`:321`). `daily_log` is the only store for `body_weight`, `water_ml`,
`walk_completed`, `hammer_completed`, `fasting_completed`, `exercises` and
`additional_workouts` — there is no `weight_log` table.

Consequence: the entire analytics screen is a lie.

| What the UI says | What it can actually see |
|---|---|
| "30-Day Rolling Stats" (`AnalyticsDashboardScreen.tsx:1518`) | ≤ 8 days |
| "Last 30 days" consistency grid (`:1368`) | 22 of 30 dots are permanently `missed` |
| 90-day weight chart (`:179`) | identical to the 30-day chart, ≤ 8 points |
| "Best" streak (`:409,423,437`) | can never exceed 8 |

**Fix:** delete the `DELETE`. The table holds one row per day — 10 years is 3650 rows. There is
no storage pressure that justifies this. If you want a cap, make it 5 years, and only prune rows
where every completion flag is 0 and `body_weight`/`water_ml` are null.

### 2. The rolling window only generates forward — a >7-day absence is unrecoverable

`src/db/database.ts:360`

```js
for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
```

Rows are never created for past dates. Combined with #1: open the app Jan 1, log Jan 1–3, go away,
reopen Jan 20 → Jan 1–8 are deleted (including the three completed days), Jan 9–19 never get rows
at all, and `computeStreaks` reads the gap as a break in both directions.

**Fix:** after removing the prune, backfill from `MIN(date)` or the recorded start date forward,
or generate `[-DAYS_HISTORY, +DAYS_AHEAD]` and stop deleting.

### 3. `toggleMealConsumed` mints inventory from nothing

`src/db/database.ts:1047–1076`

The decrement is conditional, the increment is not:

```js
if (is_consumed && meal.is_consumed === 0) {
  const inv = await db.getFirstAsync(... 'portions_available > 0 ORDER BY date_cooked ASC LIMIT 1');
  if (inv) { /* decrement */ }          // silently skipped at zero stock
} else if (!is_consumed && meal.is_consumed === 1) {
  const inv = await db.getFirstAsync(... 'ORDER BY date_cooked DESC LIMIT 1');
  if (inv) { /* increment */ }
  else { /* INSERT ... portions_available = 1 */ }   // creates stock out of nothing
}
```

Tick a meal you have 0 portions of, untick it → you now own 1 portion of a meal that was never
cooked. Repeat to inflate without limit. Even in the normal path the `ASC`/`DESC` asymmetry moves
a portion from the oldest batch to the newest on every tick/untick.

**Fix:** symmetric — the revert must credit back the exact `meal_inventory.id` that was debited.
Store it on the `weekly_meal_plan` row (`consumed_from_inventory_id`), or refuse the tick when
stock is 0 and tell the user.

### 4. Re-assigning a consumed meal slot never refunds the portion

`src/db/database.ts:1016–1033`

```js
await db.runAsync('UPDATE weekly_meal_plan SET recipe_id = ?, is_consumed = 0 WHERE id = ?', ...)
```

Flips `is_consumed` to 0 with no credit back, and the whole function is outside any transaction.
Tick Tuesday lunch (chili 4 → 3), then change Tuesday lunch to another recipe → the chili portion
is gone. Inventory drifts monotonically downward with ordinary use, which makes the
cook-when-empty reminder fire early.

**Fix:** route the reassignment through the same refund path as #3, inside `withTransactionAsync`.
Also add `UNIQUE(date, meal_type)` to `weekly_meal_plan` — the read-then-write at `:1012` has no
constraint behind it, so a double-tap can create two rows for one slot.

### 5. `DashboardScreen` — the main screen — has no `useFocusEffect`

`src/screens/DashboardScreen.tsx:338`

```js
useEffect(() => { loadToday(); }, [loadToday]);   // loadToday = useCallback(..., [today])
```

It is the only screen in `src/screens/` without one (Analytics, MealPrep, Settings, Cooking,
Shopping and RecipeDetail all have it). The drawer keeps screens mounted, so this fires once per
app launch and never again.

- Edit the weekly template or assign a meal → Dashboard keeps showing the old data until restart.
- Restore a backup → Dashboard shows pre-restore data, and ticking a box writes over the restored rows.
- Leave the app open past midnight → `today` is stale, and handlers still hold yesterday's date
  string. Water logged at 00:10 is written to **yesterday's** row. The optimistic `setState` shows
  success, then the value disappears on the next load.

Compounding this, every `daily_log` writer is a bare `UPDATE` with no INSERT fallback and no
`result.changes` check (`:519,552,557,1934,1945`) — writing to a date outside the window succeeds
and does nothing. The docblock at `:1931` claims `addWater` is upsert-safe. It is not.

**Fix:** add `useFocusEffect` + an `AppState` `change` listener that re-derives `today`, and make
those five writers real upserts.

---

## P1 — Wrong numbers, races, orphaned notifications

### 6. Hydration and meal adherence count future days as failures

`database.ts:1965` (`getWaterHistory`) and `:1290` (`getMealAdherence`) have a lower date bound
and no upper bound. The rolling sync pre-creates 7 future rows with `water_ml = 0`, and users plan
meals up to 6 days ahead.

Drink exactly your 2100 ml goal every day for a week → the card titled "Last 7 days" reads
**1050 ml avg, 50 % adherence**. Plan 21 meals on Sunday, eat all 6 by Monday night → adherence
reads **29 %**.

`AnalyticsDashboardScreen.tsx:1306` gets this right for workout stats (`l.date <= todayStr`).
The same guard is just missing in these two queries. Add `AND date <= ?`.

Side effect: `days.length` is never 0, so a new user sees "0 ml avg / 0 %" instead of the empty
state at `:647`.

### 7. The strength progression chart is empty for every user, every time

`AnalyticsDashboardScreen.tsx:910`

```js
const [selectedExercise, setSelectedExercise] = useState<string | null>(
  loggedExercises.length > 0 ? loggedExercises[0] : null
);
```

`LiftingSectionCard` mounts on the first render when `loggedExercises` is still `[]`. The
initialiser runs once, `loadData` populates the list later, `selectedExercise` stays `null`, and
the card renders "No data for this exercise yet." until the user taps a pill. The drawer never
remounts it.

**Fix:** `useEffect(() => { if (!selectedExercise && loggedExercises.length) setSelectedExercise(loggedExercises[0]); }, [loggedExercises]);`

### 8. Notification identifiers are declared, documented, tested — and never used

`src/services/notifications.ts:61,267`

```js
const BACKUP_REMINDER_IDENTIFIER = 'backup-reminder';
const MEAL_REMINDER_IDS: Record<MealType, string> = { breakfast: 'meal-reminder-breakfast', ... };
```

Neither is ever passed as `identifier` to `scheduleNotificationAsync` — grep for `identifier:`
returns nothing. Expo assigns a random UUID each time, and the only handle on it is the ID
persisted in `app_state`. The docblock at `:289` states the stable identifier exists. The tests
assert the getters return it. The app does not use it.

That is what makes the next two unrecoverable.

### 9. Restore orphans every scheduled notification, then undoes 92 % of itself

`src/services/backup.ts:309`, `SettingsScreen.tsx:623`

`listUserTables()` (`database.ts:1663`) excludes only `sqlite_%` and `schema_version`, so
`app_state` is wiped and replaced — including the live OS notification IDs. After restoring a
month-old backup, `app_state` holds dead IDs: the reminder currently scheduled in the OS can never
be cancelled from Settings (the toggle appears to work), and each reconcile adds another one.
`importBackup` never calls `reconcileScheduledNotifications()`.

Then the next launch runs the prune from #1 and deletes the 90 days of `daily_log` that were just
restored. The alert at `SettingsScreen.tsx:657` says "Restored N tables and M rows."

**Fix:** stable identifiers (#8), exclude `app_state`'s notification-ID keys from restore, call
`reconcileScheduledNotifications()` at the end of `importBackup`.

### 10. Concurrent `reconcileScheduledNotifications` orphans notifications

`notifications.ts:483–531`, fired from 7 call sites in Settings with no in-flight guard.
`cancel → schedule → setSetting(id)` is not atomic: two overlapping runs leave one notification
scheduled with no stored handle, firing forever. Stable identifiers fix this class of bug outright.
Separately, one tap on a weekday chip triggers ~10 `app_state` reads and 12 native calls for
reminders the user did not touch.

### 11. Analytics `loadData` has no cancellation guard

`AnalyticsDashboardScreen.tsx:1290`

~19 `setState` calls across 3 `await` boundaries, `useFocusEffect` with no cleanup and no `active`
flag. `SettingsScreen.tsx:300` does have the guard — Analytics omits it. Refresh, navigate away and
back quickly, and an older run overwrites `consumedMacros`/`mealAdherence`/`hydrationDays` after a
newer one has already set the metric cards. The screen shows two different snapshots at once until
the next focus.

### 12. Every Settings stepper drops rapid taps

`SettingsScreen.tsx:399,452,491,508,522,700` — all read the base value from the render closure and
`await` a DB write before `setState`. Five quick taps on "+ calories" all read 1800, all compute
1850, all write 1850. Same for all four reminder time steppers and the hydration goal.

**Fix:** functional updater form, or a local ref for the pending value.

### 13. Migrations are not atomic — a kill mid-migration bricks the app permanently

`database.ts:212`

```js
await db.execAsync(migration.sql);
await db.runAsync('INSERT INTO schema_version (version) VALUES (?)', [migration.version]);
```

Two statements, no transaction. Five migrations are non-idempotent `ALTER TABLE ... ADD COLUMN`
(v11, v12, v20, v21, v31) and SQLite has no `ADD COLUMN IF NOT EXISTS`. Get killed between the two
lines during an upgrade → next launch re-runs the migration → "duplicate column name" →
`initDatabase` rethrows → `App.tsx:78` renders a terminal error screen with no recovery.
`resetIfIncompatibleSchema` only triggers when `daily_log` lacks a `date` column, which is not the
case, so every subsequent launch fails identically. Data intact, permanently unreachable.

**Fix:** wrap both statements in `withTransactionAsync`. One-line change, removes a whole class of
unrecoverable state.

### 14. Restore interpolates column names from the backup file into raw SQL

`database.ts:1725`

```js
const columns = keys.join(', ');
await db.runAsync(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`, values);
```

Table names are whitelisted against `listUserTables()`. Column names come straight from
`Object.keys(row)` on the user-supplied JSON with no check against `PRAGMA table_info`. Values are
parameterised, keys are not.

`validatePayload` (`backup.ts:102`) also accepts `tables: [1,2,3]` (`typeof [] === 'object'`) and
`tables: { daily_log: "hello" }` (never checks the body is an array, so `for (const row of rows)`
iterates characters). `Number(null)` is `0`, which passes both the `isNaN` check and the version
gate.

Local-only impact and the transaction rolls back, but this is the one path where a user hands the
app a file from outside and expects safety. Whitelist keys against `PRAGMA table_info`.

### 15. Foreign keys are declared but never enforced

`PRAGMA foreign_keys` is set nowhere in the codebase — only `journal_mode = WAL` (`:432`). SQLite
defaults FK enforcement **off**, so every `REFERENCES recipe_library(id)` is decorative.

`deleteRecipe` (`:831`) drops the recipe and orphans `meal_inventory`, `weekly_meal_plan`,
`cooking_tasks` and `cook_log`. Delete a recipe you had cooked → its portions become invisible but
still occupy rows, the queued cooking task vanishes from `getCookingTasks` while `deleteCookingTask`
can never reach it, and `getTodaysMealsWithRecipe` (`LEFT JOIN`, `:997`) renders a planned meal with
an undefined title and `NaN` macros on the Dashboard.

**Fix:** `PRAGMA foreign_keys = ON` after open, plus `ON DELETE CASCADE` in a new migration — or
explicit cleanup in `deleteRecipe`. Turning the pragma on with existing orphans in the wild will
surface errors, so clean up first.

### 16. `set_index` collides after a delete

`DashboardScreen.tsx:468` uses `existingSets.length` as the new index, and `workout_set_log` has no
`UNIQUE(date, exercise, set_index)` (`schema.ts:604`). Delete set 2 of 3, add a new one → two rows
with `set_index = 2`, and `ORDER BY exercise, set_index` (`:2127`) is non-deterministic between
them. The set list reorders itself between reloads.

### 17. No network timeouts anywhere

`AbortController`, `AbortSignal` and `setTimeout` appear nowhere in `src/api/` or `src/nutrition/`.
RN's `fetch` has no default timeout. `batchLookupNutrition` (`openfoodfacts.ts:163`) awaits
sequentially and `RecipeEditorScreen.tsx:237` calls `lookupNutrition` in a per-ingredient loop —
importing a 15-ingredient recipe on a captive-portal connection hangs the spinner forever with no
cancel. `DiscoverScreen.runSearch` (`:120`) additionally has no request sequencing, so searching
"chicken" then "beef" can leave chicken results under a "beef" query.

**Fix:** `AbortSignal.timeout(8000)`, abort on unmount, one retry with backoff, a request-sequence
guard in Discover. TheMealDB results are never cached — `off_cache` already shows the pattern.

### 18. Smaller ones

- `upsertExerciseCompleted` (`:532`) overwrites malformed exercise JSON with `[]`. `parseExercises`
  correctly returns `[]` on garbage, but this call site turns "unreadable" into "erased". Also a
  non-transactional read-modify-write, so two fast taps can lose one toggle.
- `RecipeDetailScreen.tsx:98` fans out N shopping-list INSERTs plus one cooking task, each its own
  autocommit. A failure mid-loop leaves half the ingredients on the list and no cooking task, and
  the error path does not undo the rows already written.
- `seedBioForceLibrary` / `seedRecipeLibrary` (`:226,254`) call `prepareAsync` without
  `try/finally` — statements leak if the transaction throws.
- Body weight (`DashboardScreen.tsx:375`) accepts `"12abc"` → 12 and `"-50"` → -50, and fires on
  blur, so a stray tap mid-edit persists a partial number. One bad value flattens the entire weight
  chart via `minW`/`maxW` (`:144`).
- Profile height/age (`SettingsScreen.tsx:530`) discard invalid input with no `else` and no
  feedback, and a set value can never be cleared — which blocks `handleRecalcGoals`.
- MealPrep portions modal (`:526`): `parseInt('') || 0` → the handler returns immediately, Save does
  nothing, no message. State is never reset on close, so reopening is one tap from double-logging
  the same batch.
- `DashboardScreen.tsx:737` divides by `hydrationGoal` unguarded while line 742 directly below
  guards it. `getHydrationGoal` returns 0 for an empty string.

---

## Performance

- **No `useMemo` in the codebase.** `grep -c useMemo` returns 0 for both `AnalyticsDashboardScreen`
  (2290 lines) and `DashboardScreen` (1757 lines). In Analytics,
  `computeStrengthProgression(windowStart, todayISO, 0)` (`:273`) loops day-by-day over up to 90
  days allocating a `Date` per iteration, in the render body, for a result that depends only on two
  date strings. `bestSetPerDay` (`:917`) rescans full history per render.
  `Math.min(...chartPoints.map(...))` is built twice (`:996,999`). `loadData` triggers ≥3 full
  re-renders per load.
- **Analytics loads the entire lifetime lifting history on every focus** (`:1425`):
  `Promise.all(liftExercises.map(ex => getWorkoutHistory(ex)))` with no `sinceDateKey`, so it takes
  the unbounded branch. After a year that is 30–50 parallel queries returning thousands of rows,
  re-run on every focus and every pull-to-refresh.
- **MealPrep blanks the screen on every focus.** `setLoading(true)` + a text node swap at `:353`
  wipes the list and resets scroll position every time you return. `loadData` is a plain function
  redefined per render captured by a `[]` dep array (`:89`) — latent stale closure. Three sequential
  queries instead of `Promise.all`, one of which is the whole recipe library for a usually-closed
  modal. `renderWeeklyTab` does 28 linear `.find()` passes per render with no index map.
- **Ticking one meal checkbox runs a full schedule sync.** `handleToggleMeal` (`:423`) calls
  `loadToday()`, which starts with `syncRollingSchedule()` — a write transaction plus a DELETE —
  then six more queries. Every other Dashboard handler uses optimistic local state.
- **No indexes exist.** `grep -rn "CREATE INDEX" src/` returns nothing across all 33 migrations.
  Most tables stay small, but `workout_set_log(date)`, `workout_set_log(exercise, date)` and
  `weekly_meal_plan(date)` grow without bound and are filtered on every load.

---

## Repo hygiene

- `jest-error.log` (6.7 KB) and `temp.txt` are **committed to git**. Delete both, add `*.log` to
  `.gitignore`.
- **57 local branches are already merged into `main`**, plus 11 `worktree-agent-*` branches and
  `pr-275`/`pr-276`/`pr-278`/`temp`. `git branch --merged main | grep -v main | xargs git branch -d`.
- **No `.gitattributes` and `core.autocrlf` unset.** The working tree is CRLF, the index is LF.
  Reading the repo from a Linux mount shows all 104 files as modified. Add
  `* text=auto eol=lf` plus a one-time `git add --renormalize .`.
- `src/db/README.md` and `schema.ts`'s header document an `openDb()`, a `user_version` PRAGMA
  scheme, `migrateV<N>()` functions and a `weight_log` table. **None of these exist.** CLAUDE.md
  already flags this. Delete the stale sections rather than carrying a warning about them.
- **The test suite asserts behaviour the app does not have** (#8) and no test renders a DB-backed
  screen — `src/test/setup.ts` is not wired into `jest.config.js`. The sql.js integration harness
  from #292 is the right foundation. Point it at `syncRollingSchedule` and the inventory functions
  and every P0 above becomes a failing test.
- `.github/workflows/build-check.yml` exists but is not documented in CLAUDE.md alongside the other two.

---

## Features worth building

Ranked by value ÷ cost for a single user of an offline app. Everything here is local-only — no
backend, no account.

### Tier 1 — days, not weeks

1. **"Last time" prefill on set inputs.** One query for the most recent set per exercise, rendered
   as the input placeholder with tap-to-accept. Strong and Hevy both do this, and it is the single
   most-cited reason logging in those apps feels fast. No migration. Highest ratio in the list.
2. **Automatic rotating local backups.** With no cloud, device loss is 100 % data loss, and the
   current design is a notification that hopes you remember. Write a timestamped dump to the
   document directory every Nth launch, keep the last 7, one-tap export of the newest. Reuses the
   serializer you have.
3. **CSV export alongside the JSON backup.** A second serializer over the same queries. JSON only
   restores into this app — CSV is the escape hatch into a spreadsheet, and it is what makes a
   no-cloud app feel safe rather than trapping.
4. **Rest timer.** A `restSeconds` field in the existing exercises JSON (no migration), a foreground
   countdown, and an `expo-notifications` local notification at T-0 as the real alarm since JS timers
   die when the screen sleeps. Add `expo-keep-awake` during an active workout. Budget 2 days for the
   double-fire edge cases.
5. **Plate calculator.** `(target − bar) / 2` greedy against an available-plate multiset, plus a
   settings row for bar weight and plate inventory. ~100 lines, and one of the few features here
   that is trivially unit-testable without touching the DB mocks.
6. **EWMA-smoothed weight trend.** ~20 lines over the `body_weight` column, drawn as a second line
   on the chart you already have. Raw daily scale weight is mostly water noise — this makes an
   existing feature decision-useful. Also the prerequisite for #12.
7. **Volume per muscle group.** `bio_force_library` **already has a `muscle_group` column**
   (`schema.ts:49`). The only gap is that `Exercise` (`schema.ts:28`) has no link to it — match by
   name or add an `exerciseId` field. Then it is a query and a chart. This is much cheaper here than
   in most apps. Do warm-up set types first so warm-ups do not inflate the numbers.

### Tier 2 — about a week each

8. **Set types (warm-up / working / drop / failure) + RPE.** Optional fields inside the existing
   exercises JSON, so no migration — that is the payoff of the blob design. Cost is UI plus
   excluding warm-ups from volume and PR math.
9. **Weekly review digest.** You have the analytics screen and the scheduler. What is missing is the
   push: a Sunday-evening notification into one screen with sets per muscle, tonnage vs last week,
   mean calories/protein, weight-trend delta, adherence. A dashboard is pull, a digest is push —
   different behaviour, mostly aggregation SQL you can already write.
10. **Shopping list aggregation + aisle grouping.** `addShoppingListItem` (`:833`) is a bare INSERT,
    so adding two recipes that both need onions gives you two rows. Ingredients are already
    structured (`{ name, baseQuantity, unit }`) and `shopping_list` already has `total_quantity` and
    `unit` — the aggregation is a `SELECT ... GROUP BY` away, plus a unit-conversion table you
    partly have in `src/nutrition/units.ts`. Aisle grouping is a seeded keyword lookup, which fits
    your idempotent `INSERT OR IGNORE` migration pattern. Shop day is where meal-prep apps lose
    users.
11. **Quick-add, recent/frequent foods, copy-meal.** No new data — ranking queries over the existing
    log (`ORDER BY frequency`, `ORDER BY last_used`, hour-of-day bucket), plus "copy yesterday" as
    INSERT-SELECT. MacroFactor rebuilt its whole logger around this. Nutrition logging fails through
    friction, not ignorance.
12. **Barcode scanning.** `expo-camera`'s `CameraView.onBarcodeScanned` restricted to
    EAN-13/EAN-8/UPC-E, wired to the OpenFoodFacts lookup you already have. Note
    `react-native-vision-camera` frame processors are **not** an option — they need
    `react-native-worklets-core`, and worklets were deliberately removed to fix the TurboModule
    crash. Add a `barcode → food` cache table so a scanned product resolves offline on every
    subsequent scan.
13. **Dark mode.** `src/theme/tokens.ts` being the single source of truth is exactly the
    precondition that makes this cheap — a palette pair plus `useColorScheme()`. The real cost is
    hunting raw hex that leaked past the tokens. A gym at 6am and a kitchen at 10pm are both dark,
    so this is not cosmetic for this app's actual usage moments.

### Tier 3 — real builds

14. **Adaptive TDEE from energy balance.** The best strategic fit in this whole list: you already
    store logged calories, `body_weight` and a TDEE onboarding. A rolling regression of smoothed
    weight change against mean intake (~7700 kcal/kg), recalculated weekly, is pure local arithmetic
    over data you have. It is the one place an offline app can match MacroFactor exactly rather than
    approximately. Fiddly only because sparse logging weeks and water-weight whiplash make it
    flaky — build it after #6.
15. **Recipe import from a URL.** Parse the schema.org `Recipe` JSON-LD block that most recipe sites
    embed. No scraping heuristics needed for the ~80 % that publish it, fail gracefully into the
    manual editor for the rest.
16. **Health Connect import/export (Android).** `react-native-health-connect` v4 has a built-in Expo
    config plugin, needs `minSdkVersion 26`, works in EAS builds. Read `Weight`, `Steps`,
    `SleepSession`; write `ExerciseSession` and `Hydration` back. This is the only viable wearable
    story without a server. Worth zero if you do not own a wearable — skip it then.
17. **Notification actions** (log water / mark done from the tray) before considering a home screen
    widget. Hours of work for most of the widget's benefit. Expo's first-party widgets module is
    iOS-only and SDK 57+, and this app is SDK 54 Android-only, so a real widget means
    `react-native-android-widget`.

### Not worth building

- **Social feed, sharing, leaderboards** — needs a social graph and a server, zero value for one user.
- **Cloud sync / multi-device** — the one thing this architecture rules out. Local backups + CSV is
  the honest substitute.
- **Whoop/Garmin-style recovery or readiness scores** — those need HRV, resting HR, SpO2 and
  overnight data. A phone in your pocket cannot produce any of it. Importing them via Health Connect
  is the only honest path. Do not build a composite score out of self-reported sliders and show it
  next to a weight chart as if it were a measurement.
- **AI photo food logging** — server-side inference. An on-device model small enough to bundle would
  be worse than typing.
- **Auto-generated meal plans** — constrained bin-packing, expensive to do well, and Eat This Much's
  own reviewers report it converges on the same dishes by week 3. Manual planning plus copy-meal
  (#11) gets the real benefit for a fraction of the cost.
- **Bundling a full offline food database** — Cronometer's data is not redistributable and an
  OpenFoodFacts dump is hundreds of MB with no update channel. The barcode cache in #12 is the right
  compromise: the foods *you* eat become offline.
- **Full MEV/MRV volume prescriptions** — population-level estimates presented with false precision.
  Show the trend, do not issue verdicts.
- **Multiple routines / block periodization** — the biggest structural gap (`weekly_template` is
  exactly 7 permanent rows) and the most expensive fix. The existing 21-day auto-progression already
  covers what periodization delivers for most people. If you want 80 % of it cheaply, do
  **per-exercise double progression** — add reps to the top of a range, then add weight and reset —
  which is one field and a tweak to `buildHammerTask`. Reassess the full version only after Tier 2.

---

## Suggested order

1. **Stop the bleeding:** #1, #2, #3, #4, #5. Write sql.js integration tests for each first — the
   harness from #292 already exists and every one of these is testable.
2. **Correct the numbers:** #6, #7, then #13 (migration transaction) and #15 (FK pragma) since both
   are small and remove unrecoverable states.
3. **Fix the backup loop properly:** #8 → #9 → #10. Stable identifiers first, the rest follows.
4. **Repo hygiene** in one commit — it is 20 minutes and it makes every future diff readable.
5. **Then features**, Tier 1 in order.

Nothing in the P0 list is hard. They are all small changes. The problem is that the app has been
quietly deleting its own data for a while, which means whatever history exists on the device right
now is already gone — export a backup before you touch anything.
