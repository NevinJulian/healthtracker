# Sprint report: `sprint/auto-fixes` (sprint 2)

Autonomous sprint, started 2026-09-30 22:30 UTC. Frozen scope: the 27 open issues in `.claude/SPRINT.md` §3. The orchestrator only dispatched work, judged it, merged lanes and recorded state. Developer agents wrote every line of code, and tester agents checked every change adversarially. Security agents reviewed every change that touched `src/db`, `backup.ts` or `src/api` and wrote data or read external input; skips are recorded per issue below.

**Nothing has been merged to `main`, and no PR has been opened.** The PR waits for the cold review and the device checks in §7.

---

## 1. Outcome

23 of 27 issues landed on `sprint/auto-fixes`: 21 close fully and 2 are partial (#318, #380). 4 are parked: #314, #328, #379 and #377. Lanes A–F are merged. Lane G (#377) was **not** merged: the Linux reproduction showed the crash is not caused by sql.js, so its fix does not cure the issue.

The integration branch is green:
- `npm run typecheck` is clean.
- 856/856 tests pass in 79 suites, up from the baseline of 610 tests in 62 suites.
- The real GitHub CI `test` check concluded **success** on `215b228`. Two runs were made, one for the integration push and one for the lane-G push, and both were green.

The run did not abort:
- 4 parked out of a maximum of 8.
- No red integration gate.
- No migration edited. `schema.ts` against `main` is 73 lines added and 0 removed, appended after v37.
- No push to `main`.

Round trips:
- Five issues needed one tester rejection each before approval: #374, #366, #365, #371 and #315's display half.
- No issue needed a second round.
- Three issues had an existing test that encoded the bug being fixed: #380, #381 and #373. In each case the orchestrator authorized changing that test, as its own commit. See §6.

## 2. Merged

| Issue | Title (short) | Lane / branch | Commits | What the regression test asserts |
|---|---|---|---|---|
| #311 | reconcile does more work than needed (AC4) | B `sprint/lane-b-notify` | f7f9796, 08177d8 (+cleanup 0a1b7a8) | A second reconcile with unchanged settings makes 0 schedule and 0 cancel calls. A cook-day-only change makes exactly 1 schedule call. An identifier missing from the OS list is rescheduled. A list call that rejects causes everything to be scheduled. |
| #361 | cancel* uses stored ID instead of stable identifier | B | 576115c, f721c8d | Each cancelX removes its stable identifier from a stateful fake OS set when the stored ID is null or `''`. A legacy UUID is cancelled too, and the key is cleared. |
| #318 *(partial, Refs)* | no aborts / sequencing in src/api | E `sprint/lane-e-api` | 0083100, 111f8fb, 134efad, 985ce33, aa3da5c, 0e37408 (+3aede93) | An aborted signal rejects or resolves null and is never cached. Searching "a" then "b", with "a" resolving last, renders "b". Unmounting Discover or the editor aborts the in-flight signal. |
| #374 | CLAUDE.md stale reanimated/nav/version | F `sprint/lane-f-repo` | b8a6b8d, 97e92c6, a40aad3, 157da1c | Grep assertions: no 3.16.7 pin, SDK 57 / RN 0.86, all 5 nav screen names present, and no false `app.json`/"no remote API" claims. |
| #375 | Settings reload overwrites just-saved height/age | D `sprint/lane-d-screens` | 50bb9aa, 07dc001 | A deferred profile reload that resolves after a save or clear (height or age) leaves the typed value on screen. |
| #366 | MealPrep write failures swallowed | D | 1e87cb6, b7f935e, 0addf31, dd873c3, 8f7573d (revert), 2b774bc, 070c787, f1d1ca2, 1b929ed | Rejected log, assign or toggle shows an Alert, and the modal keeps its inputs. A failure in a post-write follow-up shows no Alert and the modal still closes. |
| #365 | Onboarding confirm has no catch | D | b8a70f8, 58bf54f, 49abc78 | A rejected `upsertBodyWeight` shows an Alert. Onboarding is not marked complete. The button is disabled while saving and re-enabled after. |
| #364 | SetLogger parseFloat garbage | D | 5d6c99c, cb69eed | "78,4" saves 78.4. "12abc" and "12.5" reps raise an alert and nothing is saved. Bounds 1–100 reps and 0.5–500 kg. |
| #315 | restore validation (remainder: readable failure + skipped report) | A + D | 74e874d, bbea6ef; d866f2a, 69ec2c8 | A restore DB failure surfaces as "Restore failed — your existing data was not changed. Details: …" with `cause` kept. The restore alert names skipped tables and columns. |
| #316 | deleteRecipe orphans four tables | A `sprint/lane-a-db` | 7728404, 67bb382, b4b8732, 3054a18, 8fea2a6 | Deleting a recipe archives it (v38 `archived_at`): it is hidden from the getters, and all 6 joined reads are unchanged. Importing an archived id brings it back. v38 only adds the column: rows orphaned by earlier hard deletes are kept (changed after the cold review). |
| #363 + #378 | garbled/future app_start_date → NaN / negative weights | A | a3aa9d0, a2ddf35, 6ff8d0a, 75c4fa8, 898e04c, aefd465 | Future and garbled start dates give only "Baseline", never NaN or a negative weight. A garbled date is rewritten to today and a future date is left alone. A valid date at +45 days still gives "+10kg". The tester explicitly confirmed #378 is fully covered. |
| #380 *(partial, Refs)* | v35 survivor rule keeps dangling-pointer row | A | bf0e784, a424cb9, 453d985 | A legacy restore keeps the live-pointer row over a higher-id NULL-pointer row, the row stays refundable, and portions are conserved. **No new migration**: a restore-only `RESTORE_SLOT_DEDUPE_SQL` replaces v35 in the replay. |
| #368 | removeMealFromPlan doesn't credit portion | A | 0805cf0, 5b5c068 | Removing a consumed row credits exactly the debited batch, and the credit and delete are atomic (proved by mutation). |
| #370 | upsertAdditionalWorkouts clobbers malformed JSON | A | a78575d, a81b7b6 | Over malformed stored JSON (or `{}`/`"x"`) the write rejects and the raw text stays byte-identical. The queue is not wedged. |
| #371 | sync backfill clobbers malformed exercises | A | e7f71f9, b1a1b85, 1d75da9, b4c86dd | For `'{oops'`, `''`, `'null'`, `'{}'` and `'"x"'`, rows at today−7, today and today+7 are byte-identical after sync. `'[]'` still backfills. Sync never throws. |
| #381 | set-log reads ordered by created_at | A | d507942, be8bf91, 7cf7260 | Sets come back in `set_index` order even when `created_at` disagrees. The day query plan uses the v37 unique index with no temp sort. |
| #382 | sync opens empty BEGIN/COMMIT | A | 7f0d915, a09da59 | A second sync of a synced DB makes 0 transactions. A garbled start date still makes 1, so the #363 write-back is kept. |
| #383 | `_ensureDailyLogRow` has no date bounds | A | d6b9f44, 1a33cb0, c24ba55 | All 6 writers reject invalid dates and dates after today+7, creating no row. Today+7, today and today−400 are accepted. |
| #372 | today's meals: orphan renders recipe of nulls | A | 86c59ff, 131aada | An orphaned plan row returns `recipe: undefined`. Live and archived recipes are unchanged. |
| #373 | empty setting reads as 0 | A | 5f4a583, 940c60d, fe7b82a | `''`, `'  '`, `'abc'`, `'0'` and out-of-range values read as the default (goals) or null (height/age). |
| #367 | latest measurement blank for skipped fields | A (+ granted Dashboard modal) | 1096d90, 2a80838, bd78d4f, 6666af2 | Latest takes the newest non-null value per field, and history gaps are preserved. The modal submits only the fields the user edited. |
| #362 | getWeeklyCookDay no range check | A | 445b6b4, 25cc481 | "999", "-1", "7", "1.5", "3abc" and `""` read as the default 0. "0"–"6" are returned unchanged. |

Lane cleanups: A f01c39b, B 0a1b7a8, D a6be28e, E 3aede93, all comment-only. F made no changes. Lane merge commits on `sprint/auto-fixes`: F c3c9dbd, B 23e1838, E 6c42331, D 34a3bf2, A 6898c98.

## 3. Parked

| Issue | How far it got | Exactly why it stalled | What a human needs to decide |
|---|---|---|---|
| #314 | Analysis | Lane A's part (atomic migrations) already landed in sprint 1 and is fully tested. The only open criterion is the `App.tsx` "Failed to initialise" dead-end screen. No lane owns that file, and any recovery action there wipes or replaces all health data. | Should the failure screen offer retry, reset, or export-then-reset, and with what wording and confirmation? Or should #314 close for the db layer and the screen be split into its own issue? |
| #328 | Analysis (second sprint parked here) | Nobody has answered either question since sprint 1. The Lift Progression chart is all-time, so bounding the fetch would silently truncate what users see. Lifetime PRs also need a `getExercisePRs()` aggregate query in `database.ts`. | Is the chart all-time or windowed? Is a lane-A `getExercisePRs(): Record<string, PRRecord>` approved? (The analyst's recommended design is on the issue.) |
| #379 | Analysis | The issue itself says a product decision is needed, and there is no owner comment. Invented all-zero backfill days count as misses in analytics. | Choose (1) an upgrade marker that caps the insert floor, which is db-only and recommended, (2) a `generated` column plus analytics exclusion, or (3) accept it with a note. For (1), also decide the marker value on already-backfilled devices and whether to delete rows already invented. |
| #377 | Development, after Linux reproduction | Reproduced on WSL with about 27 workers: the baseline crashed in 5 of 10 runs, and runs at 3 workers passed 10 of 10. **The cause is not sql.js**: a control run with `src/db/` excluded still crashed, with native SIGSEGV/SIGTRAP worker kills. The adapter-cleanup fix doesn't cure it. The root cause is unknown and correlates with worker count. The cap stays at 2, and lane G's two hygiene commits (21c6f26, 47a37fa) were not merged. | Keep the cap at 2, or raise it to 3? Put `maxWorkers` in `jest.config.js` so local many-core runs are protected too? Should the adapter-hygiene commits go in as a separate PR? Next diagnostic: `workerIdleMemoryLimit`. |

## 4. Found during sprint

Filed with the `found-during-sprint` label. **None of these were worked.**

- #397: Settings stale reload also overwrites sex, activity level and goal. Same bug class as #375.
- #398: `@react-navigation/bottom-tabs` is a dependency but nothing imports it.
- #399: Recipe import looks up nutrition sequentially, worst case about 16 s per ingredient.
- #400: The `babel.config.js` comment still says SDK 54.
- #401: A failed MealPrep `loadData` is silent and shows an empty screen.
- #402: RecipeEditor recomputes overlap and are never aborted. Security found that a stale run can **save wrong macros**.
- #403: The MealPrep Log and Assign modals have no in-flight guard, so a double press logs or assigns twice.
- #404: Onboarding `handleSkip` has no catch.
- #405: Onboarding parses with `parseFloat`. **It also has a small regression caused by this sprint** (see the comment there): after #373, an Onboarding height or age outside 50–250 or 10–120 reads back as unset.
- #406: Restore's `consumedMealsWithoutRefund` is counted before the dedupe, so it can over-count.
- #407: The restore skipped-summary caps the number of tables but not the columns per table.
- #408: `removeMealFromPlan` has no UI caller.
- #409: `eslint-disable` comments sit in a repo with no ESLint.
- #410: Dashboard additional-workout handlers write whole arrays from stale state.
- #411: A row with corrupt exercises or additional-workouts JSON silently blocks all edits for that date, with no repair path.
- #412: Restore replays v37 and discards the backup's own set order.
- #413: Restore has no orphan sweep.
- #414: Reminder day and time getters and setters don't validate. These are siblings of #362.
- #415: Measurement pills show values from older dates under a single "Last: {date}" label.
- #416: After #367, blanking a measurement can't clear a stale value from "latest".

Comments were also added to #396 (`createRecipe`'s `INSERT OR REPLACE` resets `archived_at`) and #405.

## 5. Integration branch state

- **Branch:** `sprint/auto-fixes`. The SHA before the report commit is `215b228`, and the report commit follows it.
- **typecheck:** pass.
- **tests:** 856 passed / 856, 79 suites. The baseline on `main` `fdf5c68` was 610 / 62.
- **GitHub CI `test` check:** success on `215b228`, also on `eec9ed9` and `377a113` after the earlier merges.
- **Note on timezones:** `npm test` is `cross-env TZ=UTC jest`, so every local run in this sprint was UTC. The sprint did not exercise other zones locally, apart from the #363 tester's direct `npx jest` runs under Kiritimati and Pago Pago.

**Opening the PR.** This uses the GitHub MCP, as the sprint protocol requires; the `gh` CLI is not used. Do this only after §7 is fully ticked. Call `mcp__github__create_pull_request` with:

```
owner: NevinJulian
repo:  healthtracker
base:  main
head:  sprint/auto-fixes
title: Sprint 2: db hardening, restore, notifications, screen error handling
body: |
  Autonomous sprint 2. See SPRINT_REPORT.md on the branch for per-issue tests, parked issues and the review list.
  Merge with a regular merge commit, never squash.

  Closes #311
  Closes #315
  Closes #316
  Closes #361
  Closes #362
  Closes #363
  Closes #364
  Closes #365
  Closes #366
  Closes #367
  Closes #368
  Closes #370
  Closes #371
  Closes #372
  Closes #373
  Closes #374
  Closes #375
  Closes #378
  Closes #381
  Closes #382
  Closes #383
  Refs #318
  Refs #380
```

## 6. What I would not merge without reading

1. **v38 (`schema.ts`, commit 67bb382) no longer deletes anything.** It originally swept rows in `meal_inventory`, `cooking_tasks`, `weekly_meal_plan` and `cook_log` whose recipe no longer exists. The cold review removed the sweep before v38 ran on any device: since #372 orphaned rows don't break any screen, and deleting them would destroy history that re-importing the recipe brings back. v38 is now only `ALTER TABLE recipe_library ADD COLUMN archived_at TEXT`. Read it anyway to confirm that the migration is that one statement.
2. **Three existing tests were changed because they encoded the bug being fixed.** In each case the orchestrator authorized the change and it is a separate commit:
   - bf0e784 (#380): restore survivor rule.
   - 7cf7260 (#381): set display order.
   - fe7b82a (#373): blank setting no longer reads as 0.
   These are exactly the edits a cold reviewer should challenge. Check that each old assertion really pinned the bug and not intended behaviour.
3. **#363 rewrites `app_start_date` to today when it is garbled** (75c4fa8). If a real start date were ever misclassified, the user's progression would reset permanently. Security traced every historical writer of `app_start_date` and all of them emit `YYYY-MM-DD`. A clamp in `buildHammerTask` (6ff8d0a) was added outside the work order. The tester judged it necessary.
4. **#367 changes Dashboard behaviour in two ways the user will notice.** Both follow from the semantics the issue asked for, but the product owner should confirm them:
   - The measurement modal now saves only the fields the user edited (6666af2). This was granted to lane A to stop the read fix copying old values into today's row.
   - A user can no longer clear a stale value from "latest" by blanking it (#416).
5. **#380 replaced v35 in the restore replay with new SQL (453d985).** It is restore-only and outside `MIGRATIONS`, but it decides which duplicate rows are deleted on restore. I chose this over the analyst's v39 migration to avoid running a credit-and-DELETE on every device for a restore-only bug. That is a design choice the human should agree with.
6. **#383 now throws for any write dated after today+7** (c24ba55). No current caller can trigger it. But if a future feature, such as planning ahead, writes daily_log for next week+1, it will fail loudly. That is intended, and it is worth knowing.
7. **Analyst-picked bounds nobody signed off on:**
   - set logger: reps 1–100, weight 0.5–500 kg (#364)
   - profile: height 50–250, age 10–120 (#373)
   - goals: > 0 with no cap (#373)
   The #373 bounds combine with Onboarding's looser `> 0` check to cause the small regression filed on #405.
8. **#311's reconcile skip map** assumes notification content is static. If reminder text ever becomes dynamic, the skip will leave stale text. There is also a test-only export, `resetReconcileStateForTests`, in production code.
9. **Error wording:**
   - The restore failure alert will show "Restore failed" twice: once as the title, and again as the start of the new message from #315. This is cosmetic and was not fixed.
   - #366 added Alerts with fixed English strings.
10. **History warts, all disclosed and none force-pushed:**
    - #366 contains a revert (8f7573d) followed by its split re-application.
    - #315's display test commit d866f2a doesn't typecheck on its own.
    - Several test-first commits are intentionally red on their own.

## 7. Before the PR

Leave these unticked. The human ticks them.

**Cold review**
- [ ] A fresh Claude Code session with no sprint context runs `/code-review` on `main...sprint/auto-fixes`.

**Device checks.** Run on the phone from `sprint/auto-fixes`, installed over an existing build.
- [ ] **#316:** Delete a custom recipe. It disappears from the library and the meal-prep picker. Its cooked portions still show in inventory. Re-importing it from Discover brings it back. (v38 runs on the startup path, so watch the first launch.)
- [ ] **#371 / #382 (startup path):** Cold-start the app. The Dashboard lists today's exercises. Navigate away and back: no crash, nothing changes.
- [ ] **#311:** Enable workout, cook-day and backup reminders, each 2 minutes ahead. Change only the cook-day time. Each reminder fires exactly once at the right time. Toggle one meal reminder off and on, and confirm it fires. Restore a backup and confirm the reminders still fire.
- [ ] **#361 (optional):** Toggle the workout reminder off and on in Settings. Exactly one notification fires.
- [ ] **#318:** In Discover, search "chicken", then immediately change to "beef" and search. Only beef results show. Search, then navigate away: no red box or warning in Metro.
- [ ] **#364:** Use a comma-decimal keyboard (fr-CH). Log a set with "78,4" and the row reads "@ 78.4 kg". Enter "12abc" for reps: an alert appears and the text stays.
- [ ] **#365 (startup path):** A first-run onboarding still completes and lands on the Dashboard.
- [ ] **#367:** Log only waist on one day and only chest the next. The pills show both values. Open the measurement modal, change only chest, and save. Today's row must **not** get the old waist (check history in Analytics).
- [ ] **#315:** Restore a hand-edited backup that has an extra column. The alert names the dropped table and column.
- [ ] **#366 (optional):** The happy path still closes the Log Cooked Meal modal.
- [ ] **#375 (optional):** Save a height, leave Settings, return. The value persists.
- [ ] **General, from SPRINT.md §8:** Open the app in Expo Go or a dev build before the PR. No native dependency changed this sprint, and `package.json` was untouched.
