# Sprint report: `sprint/auto-fixes`

Autonomous overnight sprint, 2026-09-18 to 2026-09-19. Frozen scope: the 36 open issues in #300–#336, excluding #334. The orchestrator dispatched, judged, merged and recorded. Every line of code was written by developer agents and adversarially checked by tester agents. Security agents also reviewed every change touching `src/db`, `backup.ts`, `src/api` or external input.

**Nothing has been merged to `main`. The PR needs human review before anything lands.**

## 1. Outcome

**33 of 36 issues landed** on `sprint/auto-fixes` and **3 were parked** (#316, #328, #333). Four of the 33 are **partial** fixes (#311, #314, #315, #318). The PR references them with `Refs` rather than closing them, and the Merged table says what is missing for each. Each landed code fix has a regression test that was shown to fail on the pre-fix code for the real reason, not an import or "not a function" error, and to pass after the fix. #336 is itself tests, so its tests were proven with mutations instead. The two repo and docs issues (#332, #335) were verified mechanically. The tester re-ran each of those proofs rather than taking the developer's word. Four schema migrations were appended (v34–v37). No existing migration was edited: `git diff main -- src/db/schema.ts` removes one header-comment line and nothing inside `MIGRATIONS`. Seven lanes merged into the integration branch with regular merge commits, never squashed. After every merge, typecheck and the full suite ran green. The integration branch is **green: typecheck clean, 584 tests / 55 suites** (baseline on `main`: 331 / 17). No abort condition was hit: 3 parked (limit 8), no red integration branch, no migration edited, no push to `main`. 16 new issues were filed as `found-during-sprint` (#360–#375; an accidental duplicate, #359, was closed). **None were worked.**

## 2. Merged

Round trips count tester or security rejections that went back to the developer. The limit was 3; the maximum reached was 2.

| Issue | Title | Lane / branch | Commits | What the regression test asserts |
|---|---|---|---|---|
| #300 | P0: syncRollingSchedule deletes daily_log history older than 7 days | A `sprint/lane-a-db` | 266cf76 66d3f58 e46607f 313877b 91e7932 231d644 0aad077 b83a2fe 04434c3 | `syncRollingSchedule.test.ts`: a row far outside the window survives a sync. `getRollingWindow.test.ts`: the window is bounded. `getDailyLogsBetween.test.ts`: the range query. `AnalyticsDashboardScreen.historySource.test.tsx`: analytics now reads 90 days at render level (a −7 mutation is caught). |
| #301 | P0: an absence longer than 7 days leaves an unfillable gap | A | bfabfdb d9ff8d7 ab6ae5e 263a593 d1890de 382b62a | `backfillGap.test.ts`: a gap is backfilled up to 90 days back, but never before the start date. Completed rows are never touched, and rows older than the ±7 window are never retro-filled with template exercises. `backfillStartDateGuard.test.ts`: a future or garbled start date is guarded, tested across month and year boundaries and 3 time zones. Tester rejected twice. |
| #302 | P0: toggleMealConsumed creates inventory out of nothing | A | 0bf2fc5 348c166 606cdcb | `toggleMealConsumedInventory.test.ts`: unticking credits exactly the batch that was debited, via the new `consumed_from_inventory_id` column (migration **v34**); total portions are conserved over tick/untick sequences. |
| #303 | P0: assignMealToPlan never refunds, is non-transactional, and duplicates slots | A | 4c8662d 854787f c392949 fc61361 01e0175 ba049bc 92ddba3 69c2d79 d74da00 | `assignMealToPlanRefund.test.ts`: a reassign refunds atomically. Migration **v35** dedupes slots and adds a unique slot index. `restoreLegacyDuplicates.test.ts`: a legacy backup containing duplicate slots still restores. Rejected twice: a kill-mid-migration double credit, then legacy backups becoming unrestorable. |
| #304 | P0: Dashboard is stale and writes to the wrong day after midnight | D `sprint/lane-d-screens` | 50feac5 f6091e8 5bb2c10 ac89374 ddb8cf9 | `DashboardScreen.midnight.test.tsx` (12 tests): a reload runs on focus and on AppState `active`. A stale overlapping load can't overwrite a newer one. After midnight, reads **and** the next weight write use the new date, **even when the reload fails**. Convergence doesn't rely on react-navigation re-invoking the effect. A same-day trigger costs exactly one DB round. Rejected once for the failed-reload hole. |
| #305 | P0: every daily_log writer silently writes nothing when the row is missing | A | 77fc8ae cdc5a90 52409f4 | `dailyLogUpserts.test.ts`: each of the 6 writers creates a missing row and asserts the write landed. |
| #306 | Hydration stats halved by future rows | A | 97dfdd6 7e4831c 64c24ed bcae28a | `getWaterHistory.test.ts`: history stops at today. `AnalyticsDashboardScreen.hydrationEmptyState.test.tsx`: an all-zero week renders the empty state. |
| #307 | Meal adherence counts future meals as missed | A | 130cadd 0e1fee3 | `getMealAdherence.test.ts`: meals after today are excluded (3 time zones). |
| #308 | Strength chart empty until a pill is tapped | C `sprint/lane-c-analytics` | 577e79b 8efa95c | `AnalyticsDashboardScreen.liftingSelection.test.tsx`: the first exercise is selected once data arrives. This is a component re-render test, and it fails when only the behavioural fix is reverted. |
| #309 | Stable notification identifiers never reach scheduleNotificationAsync | B `sprint/lane-b-notify` | 2c171a8 398f733 | `notifications.test.ts`: asserts `scheduleNotificationAsync` receives `identifier: <stable id>`, not that a getter returns its constant. 12/40 fail before the fix. |
| #310 | Restore wipes app_state and orphans scheduled notifications | B | 1edd492 186cabf | `backup.test.ts`: a successful restore cancels all and reconciles; a failed restore does neither. |
| #311 | reconcileScheduledNotifications has no in-flight guard | B | 6f0bb27 457d423 b1aeb91 081f1fa | `notifications.test.ts`: concurrent reconciles coalesce (a third pass sees the latest settings), and one failing reminder doesn't skip the others. **Partial: AC #4 excluded; the PR says `Refs`.** |
| #312 | Analytics loadData has no cancellation guard | C | 3189d8f bdbf4ea f97b321 | `AnalyticsDashboardScreen.cancellationGuard.test.tsx`: a stale slower run can't overwrite a newer one. |
| #313 | Settings steppers drop rapid taps | D | 7a9199a 490f75a d68c7f6 846aaef | `SettingsScreen.test.tsx`: rapid taps accumulate; the debounced write flushes on background or unmount; a rejected write surfaces. Security blocked once over the missing AppState flush. |
| #314 | Migrations not atomic, so a kill bricks the app | A | 778dcbd a5f9276 | `migrationAtomicity.test.ts`: a throwing migration leaves `schema_version` unchanged; a kill mid-v35 re-applies cleanly; a re-run is a no-op. **Partial: already-bricked devices and the App.tsx dead-end screen are not addressed; `Refs`.** |
| #315 | restoreFromPayload interpolates column names; validatePayload weak | A (+ granted `backup.ts`) | 14b1286 e9f4983 8f9eeed 07b1a24 89c23ed | `restoreInjection.test.ts`: an injected column key can't reach SQL (it failed before the fix with a real SQL syntax error). `backup.test.ts`: 12 malformed-payload cases are rejected. **Partial: skipped columns are reported by the function but not shown in the Settings alert; `Refs`.** |
| #317 | workout_set_log set_index collides after a delete | D (granted `database.ts`/`schema.ts`) | 905aa98 277fb67 33c4635 878eda5 01e21c2 | `workoutSetIndexCollision.test.ts`: delete-middle-then-relog, calling the way the old Dashboard did, yields no duplicate. Reads come back in logged order. Migration **v37** renumbers densely and adds `UNIQUE(date, exercise, set_index)`; it's kill-safe. A legacy colliding backup restores. Rejected once: the first tests only failed on a signature error. |
| #318 | No network timeouts, aborts or retries in src/api | E `sprint/lane-e-api` | 1beee5e 1a59e42 def1e4f 1ee6a8a 8f867a5 | `fetchJson.test.ts`, `mealdb.test.ts`, `openfoodfacts.test.ts`: timeouts, bounded retry with abortable backoff, no double fetch. **Partial: abort-on-navigation and out-of-order responses need the Discover and RecipeEditor screens; `Refs`.** |
| #319 | upsertExerciseCompleted clobbers malformed JSON; non-transactional RMW | A | 8d1145e 37e70a4 | `dailyLogUpserts.test.ts`: malformed exercises JSON is refused, not overwritten with `[]`; toggles are serialised through a promise chain. The original "expo-sqlite queues transactions" design was rejected as false; see #369. |
| #320 | Add-to-shopping-list not transactional | A (+ granted `RecipeDetailScreen.tsx`) | a6fc1ca 0913739 5c206b2 | `addRecipeToShoppingList.test.ts`: an induced mid-loop failure leaves zero rows. Removing the transaction makes it fail with 2 leftover rows. |
| #321 | Seeding leaks prepared statements on throw | A | 7e8add7 9ef7fb6 | `seedFinalizeOnThrow.test.ts`: finalize runs on throw, and a finalize error doesn't mask the original. |
| #322 | Body weight input accepts partial or absurd values | D (input) + C (chart) | ee4fbb0 389c189 · 733de02 4b74b42 c7c8292 1481f7b 4fde986 a55de6b | `DashboardScreen.test.tsx`: invalid or partial input is rejected with feedback and the decimal comma is accepted (10/14 fail before the fix). `analyticsHelpers.test.ts` and `AnalyticsDashboardScreen.weightResilience.test.tsx`: the chart ignores absurd historical values. |
| #323 | Profile height/age discard invalid input and can't be cleared | D | b06a2d7 9b2445e 5cb4219 · e081ab5 57ceca1 30a7833 2d792bd | `SettingsScreen.test.tsx`: range validation, decimal comma, inline error. `SettingsScreen.profileClear.test.tsx`: blank plus blur calls the new clear, not a save. `clearProfileFields.test.ts`: a cleared value reads back `null`, not 0. |
| #324 | Portions modal: silent Save no-op, state persists | D | da96911 29c01c4 | `MealPrepScreen.test.tsx`: Save is disabled until the input is valid, and each open gets a fresh form. |
| #325 | MeasurementsModal clobbers typing; invalid values discarded | D | c03ab22 286cce3 0d44ecf | `DashboardScreen.measurements.test.tsx`: a background reload no longer unmounts the open modal (the spinner shows on the first load only); invalid values give feedback. |
| #326 | Hydration % divides by an unguarded goal | A (reassigned from D) | b52bd5c 8baa245 | `getHydrationGoal.test.ts`: empty or out-of-range stored goals fall back to the default (`Number('') === 0` is no longer accepted). |
| #327 | perf: no useMemo in Analytics | C | 1a874bf d9f76cc 31348f5 | `AnalyticsDashboardScreen.memoisation.test.tsx`: heavy derivations are not recomputed on unrelated renders, and each dependency mutation is caught. |
| #329 | MealPrep blanks on focus, stale closure, sequential queries | D | b15b722 fcbce41 0c2ed7a 2c05479 | `MealPrepScreen.focus.test.tsx`: no blanking on refocus, a stale run can't overwrite, and a post-action refresh beats a stale focus load. |
| #330 | perf: ticking a meal runs a full sync plus six queries | D | 0c6b989 832cd45 57651c2 | `DashboardScreen.mealToggle.test.tsx`: the toggle is optimistic, with no reload on success, a reload on failure, and double taps safe. |
| #331 | perf: no indexes | A | 04ab5b1 554a945 | `indexes.test.ts`: the hot queries' `EXPLAIN QUERY PLAN` uses the new indexes from migration **v36** (they did SCAN before). |
| #332 | cleanup: jest-error.log and temp.txt committed | F `sprint/lane-f-repo` | 19ecb0c a6e5813 | Mechanical: the files are untracked and ignored (`git ls-files`, `git check-ignore`). |
| #335 | docs: db README and schema header describe APIs that don't exist | F (granted docs + CLAUDE.md) | 4ddcd6e e019e3c 290f9a8 88e5d15 5871f0c 87b764c 2346d16 bd598e3 | Mechanical: zero hits for stale API names, every documented name exists in code, and the CLAUDE.md retention sentence matches `_syncRollingSchedule`. Rejected once for "trailing 7 days". |
| #336 | test: the suite is green while every P0 is live; close the coverage gap | G `sprint/lane-g-tests` | 09a1e8a 637f6b7 d079836 29fb37a f72d701 2d7eaea 4d1874f 9d15089 7e16b78 | The gap audit found every P0 (#300–#305, #309, #314) already had a fail-before test from this sprint. Three new real-DB tests fill the rest. `syncRollingScheduleIdempotent.test.ts`: a second sync leaves `daily_log` row-for-row identical, including a real `upsertExerciseCompleted` edit. `mealInventoryInvariants.test.ts`: a seeded (0xC0FFEE) 200-step tick/untick/assign/reassign/finishCooking run checks per-recipe conservation **and** that each credit returns to the debited batch. It is mutation-proven to catch `main`'s original #302 and #303 bug shapes (no refund, wrong-batch credit, fabrication, no debit). `backupRoundTrip.test.ts`: the real `buildBackupPayload` → `restoreFromPayload` round trip is exact. Also: dead `src/test/setup.ts` deleted, and CI runs typecheck. Rejected once: a false CLAUDE.md sentence, and the invariant test was blind to wrong-batch credits. |

## 3. Parked

| Issue | How far it got | Exactly why it stalled | What a human needs to decide |
|---|---|---|---|
| #316: PRAGMA foreign_keys never enabled; deleteRecipe orphans four tables | Analysis only; no code | Turning the pragma on alone makes `deleteRecipe` **throw**, because no FK declares `ON DELETE CASCADE`. Adding cascades needs a table rebuild, **and** `restoreFromPayload` deletes and re-inserts tables in alphabetical order, so with cascades on, every restore would silently cascade-wipe the `cooking_tasks` / `meal_inventory` rows it had just restored. `defer_foreign_keys` doesn't stop cascades. `cook_log` has no FK on purpose (it's history). | When a recipe is deleted, what happens to its history (cook log, consumed plan rows, inventory)? Destroy it, keep it, or block the delete? Should consumed portions be refunded? Recommended once decided: explicit child deletes in `deleteRecipe` inside one transaction, and **no pragma until restore is restructured**. |
| #328: perf: Analytics loads all lifetime lifting history on every focus | Analysis only; no code | The issue's premise is partly stale. The chart reading `getWorkoutHistory` (LiftingSectionCard progression) is **all-time** by design, so bounding the query would silently truncate visible data. `PRSummaryCard` needs lifetime history for correct PRs, and no aggregate PR query exists, so fixing it properly needs a new `database.ts` query (lane A's file) plus a product decision. | Should the progression chart be all-time or windowed? Then add a `getExercisePRs()` aggregate query. The screen-side change is mechanical after that. |
| #333: cleanup: 57 merged local branches plus worktree/pr-* leftovers | Analysis only; exact commands posted on the issue | Every acceptance criterion is local git state on your machine or a GitHub repo setting. Nothing in it travels through a reviewable PR, and the sprint doesn't delete branches on your machine unreviewed. Also, `fix-recipe-detail-safe-area` is **not merged** (1 commit, `7d7ba67`), even though the issue lists it as a leftover. | Run the `git branch -d` sweep from the issue comment after this PR is resolved. Turn on "automatically delete head branches". Decide what happens to `fix-recipe-detail-safe-area`. |

## 4. Found during sprint

Filed with the `found-during-sprint` label. **None of these were worked on in this sprint.** Scope was frozen.

| Issue | Note |
|---|---|
| #360 | test: react-test-renderer 19.2.5 mismatches react 19.1.0, so @testing-library/react-native refuses to load |
| #361 | notifications: cancel* functions still cancel by the app_state-stored ID instead of the stable identifier |
| #362 | getWeeklyCookDay() does not range-check, so a restored backup with an out-of-range day silently stops the cook-day reminder |
| #363 | Future or garbled app_start_date gives nonsense hammer-task weights ("Baseline + -5kg", "NaNkg") |
| #364 | SetLoggerModal weight/reps inputs use parseFloat without range checks — "12abc" and comma decimals save wrong values |
| #365 | OnboardingScreen.handleConfirm calls upsertBodyWeight inside try/finally with no catch, so a failed write becomes an unhandled rejection |
| #366 | MealPrep: logCookedMeal failures are swallowed by logDbError, so the user sees success when nothing was saved |
| #367 | logBodyMeasurement's INSERT path writes skipped fields as NULL, so the "latest measurement" display goes blank for them |
| #368 | removeMealFromPlan deletes a consumed plan row without crediting its portion back to inventory |
| #369 | Overlapping withTransactionAsync calls on the shared connection can roll back each other's writes |
| #370 | upsertAdditionalWorkouts overwrites malformed additional_workouts JSON (same clobber class as #319) |
| #371 | syncRollingSchedule's exercises backfill overwrites malformed exercises JSON with template data |
| #372 | getTodaysMealsWithRecipe checks p.recipe_id instead of a joined column, so an orphaned plan row renders a recipe of undefineds |
| #373 | getNutritionGoals and getUserProfile treat an empty stored setting as 0 (Number('') === 0) |
| #374 | CLAUDE.md: stale reanimated pin guidance (says 3.16.7, which does not compile on RN 0.81) and incomplete navigation description |
| #375 | SettingsScreen: an in-flight focus reload overwrites a just-saved or just-cleared profile height/age with the stale value |
| ~~#359~~ | Accidental duplicate of #360 filed by this sprint; closed as duplicate. |

## 5. Integration branch state

- Branch: `sprint/auto-fixes` at **`fd66923`**, plus the one commit that adds this report
- Typecheck: **pass** (`npm run typecheck`, i.e. `tsc --noEmit`, clean)
- Tests: **584 passed / 55 suites**. Before the sprint (`main`): **331 tests / 17 suites**.
- The suite is also green with `CI=true TZ=UTC` (what CI runs) and with `TZ=Europe/Zurich` (this dev box). `origin/main` is untouched at `198a5f2`.
- Migrations appended: v34 (#302), v35 (#303), v36 (#331), v37 (#317). v1–v33 are byte-identical to `main`.
- Lane merges, all `--no-ff`: E `0605533`, B `c424709`, C `5de3b4c`, A `c2fe262`, F `f53ba09`, D `42d3e4e`, G `71cfcea`.
- PR: **#376**, https://github.com/NevinJulian/healthtracker/pull/376, **open and not merged.** It was opened with the GitHub MCP call `create_pull_request(owner: "NevinJulian", repo: "healthtracker", head: "sprint/auto-fixes", base: "main")`. To re-open it by hand if needed: https://github.com/NevinJulian/healthtracker/compare/main...sprint/auto-fixes. Commits after `71cfcea` (the last lane merge) touch only `.claude/sprint-state.json` and this report.

## 6. What I would not merge without reading

These are my judgement calls on where the risk is.

1. **Migration v35 deletes users' rows (#303).** It dedupes `weekly_meal_plan` slots before adding the unique index. The survivor rule is mine, not the issue's: keep the consumed row if one exists, otherwise `MAX(id)`. It runs once on every device and can't be undone. If a user has two rows in a slot that both mean something, one is gone. Read the v35 SQL and decide whether that rule is what you want **before** it ships.
2. **Migration v37 rewrites every `workout_set_log.set_index` (#317)** and adds a UNIQUE index. It's proven kill-safe and fast (12 ms on 5,000 rows) on a bundled SQLite 3.50.3, and security approved it. It's still a whole-table rewrite of user data on upgrade.
3. **`restoreFromPayload` was changed by four issues (#303, #310, #315, #317).** It now drops two unique indexes, restores through a column whitelist, then replays v35 and v37 SQL taken from `MIGRATIONS`, all in one transaction. Each piece was reviewed, but the combination is the most complex code path in the app, and it's the path that runs when a user is already in trouble. The new `backupRoundTrip.test.ts` (#336) proves a real export then restore reproduces every table exactly on sql.js, and `restoreLegacyDuplicates` / `workoutSetIndexCollision` cover legacy payloads. None of that runs on a device. Test a real restore on a device before merging.
4. **Transactions are more heavily used, and #369 isn't fixed.** expo-sqlite's `withTransactionAsync` is a bare, non-queued BEGIN/COMMIT on one shared connection, so two overlapping transactions can roll back each other's work. I checked this against the source; an analyst's claim that it queues was false. Tonight's fixes (#303, #314, #320, restore) lean on transactions more than before, which widens #369's exposure. #319 uses a promise chain precisely to avoid this. #369 is the most important open bug after this PR.
5. **Semantic decisions I made that the issues didn't specify:**
   - Unticking a meal consumed **before** v34 credits nothing, because there's no batch pointer (#302).
   - Reassigning a consumed slot to the same recipe refunds it, which "un-eats" it (#303).
   - #310's "honest alert" criterion was judged moot.
   Each is defensible, and each is a product call you haven't made.
6. **User-visible number changes.** Analytics streaks and the 30-day grid now read up to 90 days of real history instead of the ~8 days the old prune left (#300). Users will see streaks jump. That's correct, but it will look like a bug to anyone not expecting it.
7. **Residual gaps accepted by design:**
   - A Dashboard left open and foregrounded across midnight gets no reload trigger (#304). A reload always happens on focus or foreground.
   - A force-kill inside the stepper debounce window loses the last taps (#313).
   - During a background reload, the previous day's content shows briefly instead of a spinner (#325).
8. **Needs device verification, which no test here can do:**
   - #309 relies on expo-notifications upserting by `identifier` on Android.
   - #318's timeouts use `AbortController` on RN's fetch.
   - #314 and #317's migrations should be tested with an app upgrade on a real device holding real data.
9. **History wrinkles, disclosed rather than rewritten:** #312's `3189d8f` and one intermediate #322 test commit don't run on their own (a jest.mock scoping error fixed in the next commit). Bisecting through them will show a spurious failure.
10. **Partials merged under `Refs`, not `Closes`:** #311 (AC #4), #314 (already-bricked devices, dead-end screen), #315 (skipped-column reporting not shown in the UI), #318 (abort-on-navigation needs unowned screens). Don't let the PR auto-close them.
