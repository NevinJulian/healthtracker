# Sprint report: `sprint/auto-fixes` (sprint 3)

Autonomous sprint, started 2026-10-06 17:01 UTC from `main` `58a7f3f`. Frozen scope: the 20 open issues in `.claude/SPRINT.md` §3. The orchestrator only dispatched work, judged it, merged lanes and recorded state. Developer agents wrote every line of code, and tester agents checked every change adversarially. Security agents reviewed every change that wrote through `src/db`, touched `src/api`, or handled the raw database file; skips are recorded per issue in §2.

**Nothing has been merged to `main`, and no PR has been opened.** The PR waits for the cold review and the device checks in §7.

---

## 1. Outcome

All 20 issues landed on `sprint/auto-fixes` and all seven lanes are merged. Nothing is parked and no abort condition was hit. The integration branch is green: typecheck clean, 1118 tests in 93 suites (baseline 862 / 81).

Three issues needed a second round (#397, #416, #400); none needed a third. Every other issue was approved by its tester first time.

One owner decision is **not fully carried out**: #412 asked for two stale comments to be fixed. The one inside the `MIGRATIONS` array (the v37 block in `src/db/schema.ts`) was left untouched, because SPRINT.md rule 6 forbids any edit inside an existing migration. The behaviour change of #412 is complete. See §6, item 1.

16 new issues were filed during the sprint (§4). None was worked.

---

## 2. Merged

Lane merges into `sprint/auto-fixes` (regular merge commits): B `0987514`, E `976cd0e`, A `7a97abf`, F `b9e0d1e`, D `30ee844`, C `04468f9`, G `ca7c4ee`.

| Issue | Title (short) | Lane branch | Commits | What the regression test asserts |
|---|---|---|---|---|
| #414 | Reminder day/time settings validate on read and write | `sprint/lane-a-db` | `da71967` `e85f913` | 82 of 110 new cases fail pre-fix: bad stored values (`3abc`, `8:00`, `25:00`…) read as the key's default; the six setters throw `RangeError` and leave the stored value unchanged. |
| #412 | Restore renumbers only colliding `set_index` partitions | `sprint/lane-a-db` | `8a66e85` `2c86542` `5f94a7c` | A collision-free backup with `set_index` 0,1,2 and descending `created_at` keeps its (id, set_index) pairs; gaps 0,5,9 are kept; a colliding partition ends dense, ordered by `set_index` first; the unique index exists. |
| #406 | Restore's refund warning counts after slot dedupe | `sprint/lane-a-db` | `7033d36` `3f9cf8c` | 3 consumed rows in one slot plus 1 in another report 2 (was 4); all-duplicates-in-one-slot reports 1 (was 2); the reported number equals `COUNT(*) WHERE is_consumed = 1`. |
| #419 | Start-failure screen: Retry and Save data, no reset | `sprint/lane-b-start` | `93da3f8` `402ccd6` `afb133e` `dd62bcd` `fc607ec` `45d91de` | Init rejects → error text, Retry and Save data render; Retry calls `initDatabase` again and the navigator renders; the service copies and shares db then wal in order; exactly two buttons, none matching reset/delete/clear. |
| #318 | Network: OFF User-Agent and budget, import Cancel, save deadline | `sprint/lane-e-api` | `9cbac95` `8bac828` `839ac34` `7eb26f4` `2aefe47` `d65c497` `34af795` `d780c4c` `c296e5b` | OFF requests carry the exact User-Agent; the 11th search in 60 s sends nothing, returns null, is not cached; Cancel mid-import never calls `dbImportRecipe`; a never-resolving recompute saves local-table macros at 10 s. |
| #405 | Onboarding parses height/age/weight strictly | `sprint/lane-f-settings` | `230f75e` `47bf4aa` `e9842df` | `180abc` keeps Continue disabled; `78,4` saves 78.4; heights 1.8 / 40 / 300 and ages 5 / 150 are blocked with the range error shown. |
| #404 | Skip and 13 Settings handlers catch failed writes | `sprint/lane-f-settings` | `51ad899` `c4cca27` `f0ea442` `daef76e` `bb436c5` `28689b9` `9a55908` `6ce3d58` | For each handler a deferred, rejected write produces one `Error` alert and one `console.error`, and local state does not take the unsaved value; Skip re-enables. |
| #397 | Settings: stale focus reload no longer overwrites edits | `sprint/lane-f-settings` | `1bc96c5` `35f1c89` `23faef1` `b8a14da` `7b567cd` `f3a6afd` `40da49c` `d61488d` | With a held reload, sex/activity/goal changes survive (asserted through Recalculate: 3080 kcal, not the stale 2220); toggles and day chips survive; a stepper edit that was already saved survives and the next step builds on it (1900, not 1850). |
| #407 | Restore alert caps columns and name length | `sprint/lane-f-settings` | `e99af24` `c5b3e23` | 8 columns show 5 plus `and 3 more`; names over 40 characters are cut to 40 plus `…` without splitting a surrogate pair. |
| #417 | MealPrep resolves planned meals of archived recipes | `sprint/lane-d-mealprep` | `5662af0` `d0e6e39` `fa4a656` `2de5f80` `ef83ef1` | A consumed plan row of an archived recipe shows its title and `777 kcal · 55g protein` in the slot and the day total, not "Unknown Recipe"; the Log picker does not list it. |
| #401 | MealPrep shows load failures | `sprint/lane-d-mealprep` | `a10a41a` `353820b` `71cee01` `49b5ccd` | A rejected first load renders "Couldn't load your meals" with Retry (for each of the four queries); a rejected refresh keeps the rows and shows the banner, no Alert. |
| #403 | MealPrep Log and Assign ignore a double press | `sprint/lane-d-mealprep` | `2caeb78` `9c1374a` | Two presses inside one `act()` call `logCookedMeal` / `assignMealToPlan` once (was twice); Save is disabled while pending. |
| #408 | Remove a planned meal from MealPrep | `sprint/lane-d-mealprep` | `5dd3c00` `2a487ae` `0712db9` | The Remove control opens a confirm (different text for an eaten meal); confirm calls `removeMealFromPlan(plan.id)` once and reloads; Cancel and a rejection make no change. |
| #410 | Additional-workout add/toggle are read-modify-write in the db | `sprint/lane-c-dashboard` | `86459a2` `4f463ea` `d30e74c` `3b42af2` `99b49b4` | Un-awaited add(A) and toggle(B) both persist; the Dashboard calls the new functions with the change only and never `upsertAdditionalWorkouts`. |
| #411 | Corrupt day JSON: Alert and "Reset this day" | `sprint/lane-c-dashboard` | `6b795d6` `53a29a8` `eb27325` `041a198` `fb86fb9` `e6bf37b` | Refused writes throw `CorruptJsonError` with column and date; reset keeps the byte-identical text under `corrupt_json:<column>:<date>`, writes the fresh value, touches nothing else, and rolls back atomically; the Dashboard shows the Alert and calls the reset. |
| #415 | Each measurement pill shows its own date | `sprint/lane-c-dashboard` | `ab1eb9f` `2c3cb5b` `780df0d` `4e1e264` | Waist on day 1 and chest on day 2 report their own dates; a newer row with NULL does not hide an older value; no text matches `Last:`. |
| #416 | Measurements modal: placeholders, no NULL writes | `sprint/lane-c-dashboard` | `c45058c` `45363f6` `e5a6f8f` `118af59` `329d70e` `000a4eb` `58dd654` `fbaa342` `0098d42` `f47ae3d` | `logBodyMeasurement` with `{}`, `null`, `NaN` or `Infinity` inserts no row and overwrites nothing; the modal opens empty with the latest values as placeholders and sends only typed fields. |
| #398 | Remove unused `@react-navigation/bottom-tabs` | `sprint/lane-g-repo` | `1b300e1` | No jest test possible. Stand-in: 29 deletions and 0 insertions in three lockfile blocks, repo-wide greps empty, `npm ci --dry-run` clean, gates unchanged. |
| #400 | babel comment and `CLAUDE.md` corrections | `sprint/lane-g-repo` | `5749fbf` `0d3d36e` `5cd6477` | No jest test (docs). Stand-in: the tester fact-checked every changed sentence against the code, twice. |
| #409 | Remove inert `eslint-disable` comments from tests | `sprint/lane-g-repo` | `9c337cd` | No jest test. Stand-in: 53 removed lines, each a standalone `// eslint-disable` comment, 0 insertions, test count unchanged. |

**Security review**

- **Reviewed and approved:** #414, #412, #406, #419, #318, #410, #417, #411, #416.
- **Skipped, with reason:** #405, #404, #397, #407, #401, #403 (UI only, no db/api/backup code in the diff); #408 (UI only, calling `removeMealFromPlan`, which was security-reviewed in sprint 2 and run end to end by this sprint's tester); #415 (one static read-only `SELECT` plus UI); #398, #400, #409 (dependency removal, docs, comment deletions).

**Round trips**

- **#397** — rejected once: the stepper guard let a held reload overwrite an edit that had already been saved, so the next step was derived from the stale value. Fixed with a per-field edit sequence; the tester then probed all nine steppers.
- **#416** — rejected once: after the writer change, no test created a real all-NULL row any more, although such rows exist on devices; and `NaN` still inserted an all-NULL row. Fixed with raw-SQL seeded tests and a finite-number guard.
- **#400** — rejected once: a new `CLAUDE.md` sentence stated as current fact that the jest winter runtime uses dynamic `import()`; the tester found no such call in the installed code. Reworded to what is verified.

---

## 3. Parked

None.

---

## 4. Found during sprint

16 issues were filed with the label `found-during-sprint` (#422–#437). **None of them was worked.** #427 and #434 are the two with real data consequences.

| Issue | Note |
|---|---|
| #422 | `notifications.parseTimeString` uses `parseInt`, so `8abc:30xyz` parses as 8:30. |
| #423 | `App.tsx` has no error boundary for a render-time crash after startup. |
| #424 | Open Food Facts 429 responses: `Retry-After` is ignored. |
| #425 | The `__mocks__/expo-file-system/legacy.js` mock is shadowed by jest-expo's own; `documentDirectory` and `cacheDirectory` are undefined in tests. |
| #426 | Start-failure screen: Retry has no in-flight guard in code; rescue copies stay in the cache directory; the db/wal pair is best-effort. |
| #427 | `resetIfIncompatibleSchema` deletes the database at startup without asking, and Retry runs it again. **Read this one before the device check.** |
| #428 | OFF budget: a backward clock step blocks lookups; an over-budget estimate looks the same as "not found". |
| #429 | Settings: Recalculate can save calories and fail on protein; the `unhandled` assertions in the new write-error tests never fire. |
| #430 | `getRecipes` / `getRecipeById` parse ingredients JSON unguarded; one bad row breaks every recipe load. |
| #431 | Dashboard and Analytics: a failed load is silent. |
| #432 | Data-layer follow-ups: `logCookedMeal` idempotency, legacy all-NULL measurement rows, inventory inner join. |
| #433 | Settings handlers read other settings from render-time state when scheduling. |
| #434 | A `daily_log` array with null or wrong-shaped items is neither editable nor resettable. |
| #435 | Dashboard: a failed measurement save is only logged and the modal closes as if saved. |
| #436 | `expo install --check` reports four patch mismatches; `expo-doctor` rejects `splash` in `app.json`. |
| #437 | Sprint 3: small findings (one checkbox per cosmetic or minor finding). |

---

## 5. Integration branch state

- **Branch:** `sprint/auto-fixes`. The last code merge is `ca7c4ee`; state and report commits follow it.
- **typecheck:** pass.
- **tests:** 1118 passed / 1118, 93 suites, run after `npm ci --legacy-peer-deps` against the merged lockfile. The baseline on `main` `58a7f3f` was 862 / 81.
- **`src/db/schema.ts`:** add-only against `main` (0 removed lines; one 31-line hunk after the end of `MIGRATIONS`). No migration was added or edited; the schema version stays 38.
- **GitHub CI `test` check:** success on `80a84d3` (lanes B, E), `62cc088` (+A), `5b23394` (+F, D), `85442f8` (+C) and `9025544` (all seven lanes, the last push before this report). The report commit itself is docs and state only.
- **Size:** 76 files changed, +4334 / −497 against `main` (state file excluded).
- **Note on timezones:** `npm test` is `cross-env TZ=UTC jest`, so every local run was UTC, on Windows. CI runs Linux.

**Opening the PR.** This uses the GitHub MCP, as the sprint protocol requires; the `gh` CLI is not used. Do this only after §7 is fully ticked. Because `package.json` changed, `build-check.yml` (the Android APK build) will run on the PR; it has not run on this branch. Call `mcp__github__create_pull_request` with:

```
owner: NevinJulian
repo:  healthtracker
base:  main
head:  sprint/auto-fixes
title: Sprint 3: restore and settings hardening, start-failure rescue, MealPrep and Dashboard fixes
body: |
  Autonomous sprint 3. See SPRINT_REPORT.md on the branch for per-issue tests, round trips and the review list.
  Merge with a regular merge commit, never squash.

  Closes #318
  Closes #397
  Closes #398
  Closes #400
  Closes #401
  Closes #403
  Closes #404
  Closes #405
  Closes #406
  Closes #407
  Closes #408
  Closes #409
  Closes #410
  Closes #411
  Closes #412
  Closes #414
  Closes #415
  Closes #416
  Closes #417
  Closes #419
```

If you decide the stale v37 comment keeps #412 open, change that line to `Refs #412`.

---

## 6. What I would not merge without reading

1. **#412 — the unfinished part of your decision.** You asked for the stale v37 comment to be fixed. I ruled that `MIGRATIONS` stays byte-identical, so the comment in `src/db/schema.ts` (above migration 37) still says restore re-runs v37. It is now false. Either edit those comment lines by hand or decide the rule covers comments too. Also read `RESTORE_SET_INDEX_SQL` (`2c86542`): it uses a TEMP staging table inside the restore transaction, and that has only ever run under sql.js, never on real expo-sqlite. I added a device check for it.

2. **#411 — a destructive path, and two rulings of mine.** `resetCorruptDayColumn` (`041a198`) overwrites a day's exercises or additional workouts. It was tested hard (byte-identical kept text, atomic both ways, fresh value identical to a normal sync), but read it. My rulings: the function belongs to lane C; and on a key collision the kept text goes under `corrupt_json:<column>:<date>:2` (then `:3`) so the first copy is never overwritten — your decision names only the plain key. The raw text is read inside the queued write unit but outside the transaction; that is safe only while every `daily_log` writer goes through `_enqueueWrite`. `instanceof CorruptJsonError` has only been exercised under jest, not Hermes.

3. **#419 — raw database export.** `src/services/rescueExport.ts` hard-codes `healthtracker.db` and the `SQLite/` directory (verified against expo-sqlite's default directory by reading, not by running). The db and wal are shared as two separate share sheets; on Android the second may replace the first, and a db without its wal is incomplete. Only the phone can tell. Also read #427 first: Retry re-runs `resetIfIncompatibleSchema`, which can delete the database.

4. **#416 commit `e5a6f8f` and #415 commit `2c3cb5b` — rewritten existing tests.** `e5a6f8f` rewrites six assertions that encoded the old prefill and null-on-blank behaviour (authorized, own commit). In `2c3cb5b` the developer edited four existing assertions and removed two (`latest.date`, `latest.id`) without stopping to report as instructed. The testers judged both line by line and found nothing weakened, but these are the commits where a protection could have been lost.

5. **#318 — two behaviours that are not what a user would guess.** Cancel pressed after the database write has started is ignored: the recipe is saved and "Imported!" shows. The window is milliseconds, but your decision says Cancel "saves nothing". And the 10-per-minute Open Food Facts budget is shared by the editor's live recompute and by imports; when it runs out, ingredients are silently estimated and those macros are saved.

6. **#408 — confirm text that can be wrong, and a small target.** For an eaten meal logged before inventory pointers existed, Remove deletes the meal and credits nothing, while the confirm says the portion goes back to inventory. The Remove control is about 26×26 px.

7. **`CLAUDE.md` (#400).** It is the instruction file every agent session reads. Three lines changed; both the tester and I read the diff and found description only, no instruction changed. One imprecision remains: `@expo/vector-icons` is listed as needing native modules, where the real reason is native font loading. The new text also says nobody has verified whether the `expo/src/winter` stub is still needed on Jest 29.7 — that is true, and unresolved.

8. **Picks that nobody decided.** Onboarding weight bounds 20–400 kg (#405); restore-alert caps of 5 columns and 40 characters (#407); MealPrep error wording and the clay-coloured banner (#401); the Alert title "Remove meal" and the control's placement (#408); the "Reset this day" Alert copy (#411); setters throwing `RangeError` (#414); renumbering the whole colliding partition, not only the tied rows (#412).

9. **Process failures worth knowing.**
   - The lane F cleanup agent returned an empty report. I verified its commit `704e0f6` by reading the diff (line wrapping only) and by the merge gates.
   - #410's developer changed a line in `mapLogRow`, outside lane C's region. It was reverted in `99b49b4`.
   - Several commits do not typecheck on their own (test-first commits, and `2c3cb5b`, `2aefe47`, `5662af0`). The tips are green, but `git bisect` will stumble on them.
   - #401's race orderings were checked by reading the run-id guard, not by probes.
   - The `expect(unhandled).toEqual([])` assertions added in #404 prove nothing under jest (#429).

---

## 7. Before the PR

Run from `sprint/auto-fixes` on the phone. All unticked; tick them yourself.

- [ ] **Cold review:** a fresh Claude Code session with none of this sprint's context runs `/code-review` on `main...sprint/auto-fixes`.
- [ ] **CI on the tip:** the GitHub `test` check on the tip of `sprint/auto-fixes` is green (it was on `9025544`; the report commit follows it).
- [ ] **#398 (dependency removed — open the app first):** Expo Go from the integration branch. Open the drawer, visit every drawer screen, Recipes → RecipeDetail and Discover → DiscoverDetail and back. No red screen, no missing-module error.
- [ ] **#419:** temporarily add `throw new Error('forced')` at the top of the init `try` in `App.tsx`, first attempt only (do not commit it). Launch: title, "forced", Retry, Save data and the no-reset sentence show; no other button. Tap Save data: a share sheet opens for the db; save it and confirm a non-zero size; a second sheet follows for the wal if one exists; both files arrive. Tap Retry: the normal app opens with data intact.
- [ ] **#412 (added by the orchestrator):** restore any backup that contains logged sets. The restore completes, the set order in a workout day is unchanged, and logging one more set works.
- [ ] **#411:** corrupt today's `additional_workouts`, then add a workout: the Alert appears. Tap "Reset this day": the list is empty and adding works. Repeat for `exercises`: the template's exercises return, all unchecked. Export a backup and confirm the unreadable text is in it under `corrupt_json:…`.
- [ ] **#410:** Dashboard with one extra workout. Add a second and immediately tick the first: both show. Force-close and reopen: both are still there and the tick is kept.
- [ ] **#415:** log waist today and chest on an earlier date. Each pill shows its own date and there is no "Last:" header. Log one field: only that pill's date becomes today. On a fresh install the section reads "No measurements logged yet".
- [ ] **#416:** with a saved waist and chest, open the measurements modal: inputs are empty with the old values as grey placeholders. Type a new chest only and save: the chest pill shows today, the waist pill keeps its old date. Save with nothing typed: nothing changes. Type "abc" and save: an error shows, nothing changes. Restart: values persist and the Analytics measurements card shows no empty entry.
- [ ] **#405:** fresh install. Step 1: height `1.8` keeps Continue disabled with an error. Enter `178,5` and age 30, continue. Step 3: weight `78,4`, finish. Settings shows height 178.5 and age 30.
- [ ] **#404:** fresh install, tap Skip: the app opens to the Dashboard.
- [ ] **#417:** cook a recipe, assign it to today's Lunch, tick it consumed. Delete the recipe (this archives it). Meal Plan, Weekly: the slot shows the recipe title and kcal, and the day card shows "CONSUMED TODAY" with the kcal. "+ Log Cooked Meal" does not list the deleted recipe.
- [ ] **#401:** open MealPrep: loading text, then data, no banner. Switch tabs, leave and return: no banner, no blank flash. With an empty inventory the normal empty state shows, not the error.
- [ ] **#403:** "+ Log Cooked Meal", 4 portions, double-tap Save fast: inventory is +4, not +8. Assign: double-tap a recipe row: one assignment, the modal closes.
- [ ] **#408:** Lunch assigned and eaten. Tap Remove: the eaten-meal confirm appears. Cancel: nothing changes. Remove: the slot shows Assign, inventory is +1, the meal is gone from nutrition history. Repeat with an unticked meal (simple confirm, inventory unchanged) and with a meal whose recipe is archived. Check the Remove control is comfortable to hit next to the checkbox.
- [ ] **#318:** import a Discover recipe with many unknown ingredients and tap Cancel while the spinner runs: the spinner stops and the recipe is absent from the library. On Wi-Fi with no internet, save a recipe containing "dragonfruit": the save completes in about 10 s and keeps local-table macros.

No device check: #414, #406, #397, #407, #400, #409.
