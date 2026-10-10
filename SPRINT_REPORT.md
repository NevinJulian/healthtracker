# Sprint report: `sprint/auto-fixes` (sprint 5)

Autonomous sprint, started 2026-10-09 07:24 UTC from `main` `e4e6e3b`, finished at about 09:05 UTC in one session. Frozen scope: the 11 open issues in `.claude/SPRINT.md` §3, the first feature sprint. The orchestrator only dispatched work, judged it, merged lanes and recorded state. Developer agents wrote every line of code, and tester agents checked every change adversarially. Security agents reviewed every change that reached `src/db`, the backup and restore path, `src/api`, the filesystem or external input; skips are recorded per issue in §2.

`/sprint` was called with `resume`. The state file found was sprint 4's (finished, merged as PR #446, older than 24 hours) and no `sprint/auto-fixes` branch existed, so there was nothing to resume and sprint 5 started fresh.

**Nothing has been merged to `main`, and no PR has been opened.** The PR waits for the cold review and the device checks in §7.

---

## 1. Outcome

10 of 11 issues landed on `sprint/auto-fixes` and all four lanes are merged. **#352 (import a recipe from a URL) is parked** after three rejected test rounds; its work is on `sprint/lane-d-recipes` and is not on the integration branch. No abort condition was hit. The integration branch is green: typecheck clean, 1778 tests in 129 suites (baseline on `main` 1387 / 107), and the GitHub `test` check is green on every lane merge.

Three issues needed more than one round:

- **#347** went back once: the security review blocked it (a unit named `constructor` wrote `NaN` into a shopping-list quantity), and I added two of the tester's findings to the same round.
- **#338** went back once, on my decision, although tester and security had both approved it: the new pruning could delete the pre-restore safety snapshot it had just written.
- **#352** was rejected three times and parked.

One migration was added: v39, `ALTER TABLE workout_set_log ADD COLUMN set_type TEXT;`. `src/db/schema.ts` differs from `main` by exactly that one added line; no existing migration was touched.

**Read before merging:**

- **#442 lands without the fix for #452.** #442's new message tells users to "open the recipe in the editor later and save it". Today that save silently deletes every ingredient stored with quantity 0. The fix was built and tested inside #352, which is parked. See §6, item 1.
- Several features contain choices the decisions did not make. They are listed in §6, items 8 and 9, and three are marked "Read this one" in #455.

7 new issues were filed during the sprint (§4). None was worked.

---

## 2. Merged

Lane merges into `sprint/auto-fixes` (regular merge commits): A `da4e89a`, B `47a1443`, D `ec31d05`, C `664e181`. None had a conflict.

| Issue | Title (short) | Lane branch | Commits | What the tests assert |
|---|---|---|---|---|
| #344 | Set types: working and warm-up | `sprint/lane-a-training` | `23623e3` `a3f1fcd` `fd43749` `91bf0a7` `da6298c` `10a3f39` | A warm-up is stored as `'warmup'`, a working set as NULL; v39 is the last migration with the exact SQL, and a row from before it reads NULL; a backup round trip keeps the value and an older backup restores NULL; `computePRs` and `bestSetPerDay` of a mixed history equal those of its working sets; the toggle starts on Working on every open and keeps the choice while open; warm-up rows show a label. 13 tests fail before the feature code. |
| #337 | Last session's set in the set logger | `sprint/lane-a-training` | `acf0a79` `759d6d1` `c6a6547` `4bc6592` `cf0ffce` `e55c722` `247f190` `57d39b3` | `getLastSetForExercise` returns the working set with the highest `set_index` of the latest earlier day, skips warm-ups and today, and uses the `(exercise, date)` index (`EXPLAIN QUERY PLAN`); the line reads "Last time: 80 kg × 8 · yesterday" / "N days ago"; tapping fills both inputs; both inputs show the values as placeholders; no history means no line and empty inputs; a rejected read leaves the logger usable. |
| #342 | Weight trend line and kg/week rate | `sprint/lane-a-training` | `9ebf5a4` `078e92a` `bd6570e` `957426b` `37659ba` `440aaef` `b852bfa` `ef7012b` | Trend values for a hand-computed series with α = 2/11 (80, 80, 80, 80, 81.8182, 83.3058, 84.5229); a gap in dates changes nothing; the rate is the least-squares slope over calendar days of the last 14 days (−0.7 kg/week for the test series) and "—" with fewer than 5 weigh-ins; the chart shows a dot per weigh-in and the line from the 5th; the 30-day view cuts the 90-day trend and does not restart it; the Weight tile shows a trend change or "—", never a raw difference. |
| #444 | Remove confirm no longer promises a refund that is not given | `sprint/lane-b-meals` | `fee7eea` `eb6295b` `14194af` | An eaten meal without an inventory pointer gets exactly "This meal will be removed from your nutrition history."; with a pointer the old text; not eaten the old short text. 1 test fails pre-fix. A db test pins the pointer the loader returns for a tick without stock. |
| #347 | Shopping list: merge at write time, group by aisle | `sprint/lane-b-meals` | `a866883` `53058f3` `1c92118` `455b5db` `6455c65` `87e59fd` `2ea8f6d` `ba52f81` `34b0c07` `013ab3b` `b0273aa` `3871273` | "Onion, diced" 1 whole plus "onion, chopped" 2 whole is one line of 3; 500 g + 0.5 kg is 1000 g; g never merges with ml; a checked line is never merged into; two items of one recipe merge and a failing item rolls the whole add back; units named `constructor` or `__proto__` sum normally; an overflowing sum makes a new line; the row shows 1.25 for a stored 1.25; the ten sections render in the decision's order; no keyword sits in two sections and no seeded ingredient falls into Other. |
| #348 | Copy a meal, copy a day, "Often cooked" | `sprint/lane-b-meals` | `1c88e43` `877e742` `0e6e388` `6a25227` `a47912e` `930bf4f` `1637168` `05ff77d` `421aada` `0efe49a` `d47ed9b` `3358f01` | A copy fills only empty slots and returns `{copied, skipped}`; an occupied slot is unchanged; copies are unticked with no inventory pointer and `meal_inventory` is untouched; the source day, duplicates and malformed dates are ignored; every result message word for word; a double tap copies once; the ranking counts cook events with a 0.95-per-day decay, clamps future dates and leaves out archived recipes; the picker shows "Often cooked" first and each recipe once. |
| #442 | Discover import: wording, 429 receivers, "In your library" | `sprint/lane-d-recipes-442-443` | `711b910` `31c2726` `5f0b565` `d0c057d` | A lookup that itself receives a 429 resolves `'not-looked-up'`, sets the pause and caches nothing (12 of 22 fail pre-fix); a 503 still resolves null; the Alert and the card use the new sentence, singular and plural, with no "minute"; a recipe found in the library on load, or an import that answers "Already in your library", shows "In your library"; a fresh clean import keeps "Macros computed from local data". |
| #443 | Recipe editor: "Saved" Alert before the editor closes | `sprint/lane-d-recipes-442-443` | `9dd5480` `1c6136e` `b37248a` `45be56c` | After a save with ingredients that were not looked up (deadline, aborted recompute, or refused by the budget) one Alert titled "Saved" shows the count, singular or plural; the editor closes exactly once when it is answered or dismissed, never after an unmount; no Alert when every lookup finished; Save is disabled but not labelled "Saving…" while the Alert is up. 8 tests fail pre-fix. |
| #338 | Automatic rotating local backups | `sprint/lane-c-data` | `58ed095` `1159bd8` `5265a1b` `7b403cb` `5071407` `3cb297d` `6f82e6e` `92da621` `d4c1f71` `6dfa160` `b5a54f6` `88000bd` `7db3ccd` `1d69df8` `15ed805` `7243da4` `d168992` `6a39c40` `e6fb6e6` | A backup is written when none exists or the newest is at least 24 h old, to a temp name and then moved; only the newest 7 by file name remain and foreign files are untouched; a failed write prunes nothing; two calls write once; none is written during a restore; the start is not delayed and a rejection never reaches the recovery screen; safety snapshots go to the document directory, the newest 3 stay, and the one just written is never pruned; restoring from the list validates like a picked file and never touches its source; a round trip on a real database gives the same rows. |
| #339 | CSV export | `sprint/lane-c-data` | `edc742c` `8ec9bba` `83cb3f2` `1b4eb66` `5aafc11` `82a70de` `e57f83c` `308cc0f` `b8f9757` `c8bd38a` | Fields with commas, quotes, CR, LF and umlauts are quoted per RFC 4180; each file starts with one BOM and every line ends in CRLF; an empty table gives the header only; the three header rows match the decision; `set_type` is `warmup` only for `'warmup'`; a meal whose recipe is missing keeps its date, slot and tick; the three files are written and shared in order and a failed one does not stop the next; the button reports a partial and a total failure. |

Lane cleanup commits: A `9e4c73f` (comments only), C `ae52f46` (two constants moved above a docblock in `backup.ts`; I read the diff: both are unchanged literals moved past a comment, used only inside functions further down). Lanes B and D needed none.

**Security review**

- **Reviewed and approved:** #344, #337, #347 (blocked in round 1, approved in round 2), #348, #442, #443, #338, #339.
- **Skipped, with reason:** #444 (one text branch in `MealPrepScreen.tsx` on a field the screen already holds, plus tests); #342 (arithmetic helpers and one screen, no database, backup, api or filesystem code).

**Round trips**

| Issue | Round trips | Why |
|---|---|---|
| #347 | 1 | Security BLOCK: the unit table was a plain object, so a unit of `constructor` or `__proto__` made a second add write `NaN` to the quantity; the merged sum was not checked for overflow. Sent back in the same round by me, although the tester approved: the row printed a stored 1.25 as "1.3", and the tester's list of misfiled ingredients (one of them a seeded name). |
| #338 | 1 | Sent back by me although tester and security approved. Security's note: the snapshot prune keeps the newest 3 by name and did not exempt the file it had just written, so after a corrected clock the fresh pre-restore snapshot could be deleted at once. The tester's note: a test for a missing folder guarded nothing because the mock did not behave like the real API. |
| #352 | 3 | Parked. See §3. |

All other issues passed on the first test round.

---

## 3. Parked

| Issue | How far it got | Exactly why it stalled | What a human needs to decide |
|---|---|---|---|
| #352 Import a recipe from a URL | Fully built: 21 commits on `sprint/lane-d-recipes` (tip `a355753`), 1829 tests green on that branch, security approved all three rounds. Fetch limits, the JSON-LD parser, the editor prefill and the dialog passed every round. About 62 ingredient lines from seven real recipe sites: none wrong through the parser. | The ingredient line parser, three times for the same class of defect: a confident wrong quantity where the decision asks for a name without a quantity. Round 1: English unit words were not recognised ("1 1/2 cups flour" gave 1.5 whole "cups flour"; 14 of 14 English lines wrong), "1.000 g" gave 1 g. Round 2, fixed word by word: still wrong on "1-1/2 cups", fl oz, `T`/`t`/`c`, "1 to 2 tablespoons", "1,000 g". Round 3, rebuilt as an allow-list: all of that fixed, but a modifier between the quantity and the unit still slips through as a bare count: "1 heaped tsp sugar" gives 1 whole "heaped tsp sugar"; the same for "level", "scant", "gestrichene", "gehäufter", and the abbreviations "Pk." and "Pr.". 6 of 43 new probe lines were wrong. | Finish it (the remaining rule is small: do not count when either of the first two words of a bare-count name is a unit or measure word, then one more test round), or set a different bar for free-text ingredient lines. The allow-list also made some lines name-only that parsed before ("250 gr butter", "1 Becher Schmand", "250g/9oz plain flour"). Known and unfixed on the branch: pages that are not UTF-8 import with broken umlauts; the source URL is not stored. The full account is in a comment on #352. |

The root cause is partly in the work order: its unit map listed German words only, and I did not catch that when I read it. The first developer and the first two fixes then chased word lists.

Parking #352 has one side effect: commit `76d752f` on that branch also fixes a data loss that exists today (#452). It does not land.

---

## 4. Found during sprint

7 issues were filed with the label `found-during-sprint`. **None of them was worked.**

| Issue | Note |
|---|---|
| #449 | Backup export reads the tables one by one, not in one transaction. A write between two reads gives a file whose tables disagree. The automatic backup at start (#338) makes the overlap a little more likely. |
| #450 | An ingredient stored with quantity 0 shows as "0 g" in the recipe detail and goes on the shopping list as a 0-quantity line. |
| #451 | Recipe editor: tapping Recompute or editing a row while a save is pending saves the recipe with partial macros (reproduced: 0 / 0 / 0 / 0 instead of 10 kcal). Present before the sprint. |
| #452 | Recipe editor: saving a recipe silently deletes its ingredients that have quantity 0. Present before the sprint. Its tested fix is inside the parked #352, and #442's new wording sends users to exactly that save. |
| #453 | Shopping list: "Onion" and "Onions" stay two lines, because the #347 decision has no plural handling. |
| #454 | `parseMeasure` turns volumes into grams at 1 ml = 1 g for every ingredient ("1 1/2 cups flour" is 360 g), so macros for cup-measured dry goods are too high. On `main` today through the Discover import. |
| #455 | Sprint 5: small findings. 85 checkboxes: cases that need restored or hand-edited data, a wrong clock or one exact moment, plus comments, tests and tidy-ups. Three are marked "Read this one". Ten of them concern only the parked #352 branch. |

---

## 5. Integration branch state

- **Branch:** `sprint/auto-fixes`. The last commit that changes code is the lane C merge `664e181`; state and report commits follow it.
- **typecheck:** pass at `664e181` (exit 0).
- **tests:** 1778 passed / 1778, 129 suites at `664e181`, with `--maxWorkers=2`, exit 0. The baseline on `main` `e4e6e3b` was 1387 / 107. After each merge: A 1460 / 110, B 1623 / 120, D 1638 / 121, C 1778 / 129.
- **`src/db/schema.ts`:** one line added against `main`, none removed: `{ version: 39, sql: 'ALTER TABLE workout_set_log ADD COLUMN set_type TEXT;' }`.
- **GitHub CI `test` check:** success on `caea6aa` (lane A), `ad5d3d2` (+B), `bfc0492` (+D) and `7d2cbcf` (all four lanes, the last push before this report). The report commit itself is docs and state only.
- **Size:** 66 files changed, +6689 / −282 against `main` (state file and report excluded). 88 commits besides merges and state commits.
- **Not changed:** `package.json`, `package-lock.json`, `app.json`, `eas.json`, `babel.config.js`, `jest.config.js`, `__mocks__/`, `CLAUDE.md`, the workflows. So `build-check.yml` will not run on the PR, and no native dependency moved.
- **Not on this branch:** anything of #352. `src/api/recipeHtml.ts`, `src/api/fetchRecipePage.ts` and `src/nutrition/parseIngredientLine.ts` do not exist here.
- **Note on timezones:** `npm test` is `cross-env TZ=UTC jest`, so every local run was UTC, on Windows. CI runs Linux.
- **Left on disk:** the lane worktrees `C:/git/ht-lanes/lane-a` … `lane-d` and the work orders in `C:/git/ht-lanes/wo/`. All lane branches are pushed, including the parked `sprint/lane-d-recipes`.

**Opening the PR.** This uses the GitHub MCP, as the sprint protocol requires; the `gh` CLI is not used. Do this only after §7 is fully ticked. Call `mcp__github__create_pull_request` with:

```
owner: NevinJulian
repo:  healthtracker
base:  main
head:  sprint/auto-fixes
title: Sprint 5: set types, last-time line, weight trend, shopping merge, meal copy, automatic backups, CSV export
body: |
  Autonomous sprint 5. See SPRINT_REPORT.md on the branch for per-issue tests, round trips and the review list.
  Merge with a regular merge commit, never squash.
  #352 is parked and is not part of this PR.

  Closes #337
  Closes #338
  Closes #339
  Closes #342
  Closes #344
  Closes #347
  Closes #348
  Closes #442
  Closes #443
  Closes #444
```

If you decide to hold #442 until #452 is settled (§6, item 1), change `Closes #442` to `Refs #442`; that keeps the issue open but does not take the wording out of the branch.

---

## 6. What I would not merge without reading

1. **#442 ships a message that leads into a data loss (#452).** The import Alert and card now say "… Open the recipe in the editor later and save it to look them up." The editor's `rowsToIngredients` drops every row with quantity 0 on save, so a Discover-imported recipe loses its vague-measure ingredients when the user follows that advice. The drop is older than this sprint; the wording is yours and is implemented as decided. The fix exists, tested and security-approved, in commit `76d752f` on the parked branch, tangled with the URL import's `draft` param. Decide before merging: pull the quantity-0 rule out and ship it with this PR, or accept the gap for now.

2. **#338 — `src/services/backup.ts` deletes files.** Every delete goes through one function that re-checks an anchored name pattern and builds the path from a folder constant, and the tester threw 18 odd names at it without one wrong delete. But all of it ran against an in-memory file map and sql.js, never against a real file system. The device check is the first real run. Also know:
   - The `App.tsx` call sits in an effect that waits for the database, the fonts and no failure screen. The work order put it directly after `setDbReady(true)`; the developer moved it so it cannot run on the recovery screen.
   - `importBackup` was split into the picker plus `restoreBackupFromUri`, and the Settings restore handler was folded into a shared `confirmRestore`. The existing restore tests pass untouched, which is the evidence that the picked-file path is unchanged.
   - A freshly emptied database pushes out your last good automatic backup after seven daily app-opens.
   - An automatic backup now runs right after start, which makes #449 a little more likely.
   - The self-deleting snapshot (round 2) needed a corrected clock plus three earlier restores. Both reviewers had let it pass.

3. **#344 — migration v39 has only ever run on sql.js.** The tester migrated a real v38 database through `initDatabase` on that engine; expo-sqlite on the phone is the device check. Backups carry the column with no change to `backup.ts` or `restoreFromPayload`, because the dump is `SELECT *` and restore filters keys against the live table. A `set_type` that is neither NULL nor `'warmup'` counts as working everywhere.

4. **#347 — merged shopping lines cannot be un-merged.** The merge is inside `_addShoppingListItemImpl`, in the write queue and the recipe transaction. Read `src/data/shoppingMerge.ts` (40 lines) and the three-line change in `database.ts`. The aisle table in `src/data/aisles.ts` is 722 keywords written by an agent, checked only against the seeded recipes and about 40 probe names; expect misfiles. The row now shows up to three decimals for sums that the old one-decimal format would have rounded wrongly; values it showed exactly look as before.

5. **#348 — what "copy" means was decided by the analyst.** "The next 7 days" became the six other days the screen shows. A copy does no stock check, although the Assign picker requires stock. A copy takes an archived recipe along. A copy is its own write and does not go through `assignMealToPlan`; it relies on the write queue, not on the unique index, to keep a slot single.

6. **#339 — the CSV has a formula guard you did not ask for.** A text field starting with `=`, `+`, `-`, `@`, TAB or CR gets a leading apostrophe, visible in the spreadsheet. It is there because recipe titles can come from the web. It is one function (`guardFormula`); remove it if you want a byte-faithful export. Excel with a semicolon list separator may not split the files into columns; the device check uses Google Sheets. Whether the three share sheets really appear one after the other on Android is unverified.

7. **#342 — my ruling changed the Weight tile, and the line has never been seen on a screen.** The analyst's design fell back to the raw first-to-last difference whenever the first weigh-in of the month had no trend value yet, which is every user in their first month. I ruled that the tile shows a trend change or "—", because your decision says "trend values, not raw ones". That changed one existing assertion (`weightResilience`, "+5.0" from two raw points became "+1.5" from six). The line is drawn with rotated Views sized from a layout event; jest only sees it through a simulated event. With exactly five weigh-ins the rate can read "+2.5 kg/week".

8. **Work orders I amended.** Each amendment is appended to the work order file and recorded in the state file.
   - #442: "In your library" only for a recipe that was already in the library; the analyst had it replace the subtitle for every clean import.
   - #344: the weight prefill stays as it is; the analyst wanted it to skip warm-ups.
   - #342: no raw fallback on the Weight tile (item 7).
   - #443: when an existing assertion ("no Saving… label after a deadline save") failed against the planned design, I kept the assertion and changed the design: `saving` is released after the write and a separate `closing` state blocks Save while the Alert is up.
   - #352: the script-tag scan must be linear; the work order's regex was quadratic on a hostile 3 MB page. (Parked, but the reasoning holds if it is finished.)

9. **Picks that nobody decided.**
   - #344: a two-segment toggle between the "Add set" heading and the inputs; a gold "Warm-up" pill in the set list; a warm-up-only exercise shows "No sets logged yet.".
   - #337: when the most recent earlier day holds only warm-ups, the line shows the last working set of the next older day; the line sits between the toggle and the inputs; tapping overwrites typed text; exercise names match exactly.
   - #342: dots 6 px at 0.35 opacity, a 2 px line, no legend; the rate line under the range toggle; the window is the last 14 calendar days counted back from today.
   - #347: the merged line keeps its own name and unit; the sum is rounded to three decimals; the lowest-id open line gets the amount; checked items sit below unchecked ones inside a section; headers render in capitals through the existing style; longest keyword wins, and keywords of three letters or fewer match whole words only.
   - #348: the chooser wording and rows ("Today", "Tomorrow", then a weekday date); all result messages; "Often cooked" recipes are removed from the full list, which gets an "All recipes" header; ties by later date, then title.
   - #442: the singular sentence ("1 ingredient couldn't be looked up right now and counts as 0. … look it up.").
   - #443: Alert title "Saved", button "OK"; the Alert also counts lookups refused by the budget; the banner keeps the names in brackets.
   - #338: file names `healthtracker-auto-YYYYMMDDTHHmmssZ.json`; a file dated more than an hour ahead is ignored for the 24-hour check and never pruned; row text "8 Oct 2026, 14:03" and sizes in B / KB / MB; the empty-state sentence; "Share failed" and "Sharing unavailable".
   - #339: CRLF line ends; NULL written empty; flags as stored; row order; "Save <filename>" as dialog title; "CSV export incomplete" and "CSV export failed"; the formula guard (item 6).

10. **#443 and #451.** The new Alert reports what was saved. If the user taps Recompute while a save is pending, the save finishes early with partial macros (#451, older than the sprint); the Alert then says "2 ingredients" where the user expected 1. The `if (closing) return` guard has no test that can reach it.

11. **`CLAUDE.md` and the agent files were not touched, and they are behind.** No lane owned them. `CLAUDE.md` does not mention migration v39, automatic backups, `src/services/csvExport.ts`, `src/data/aisles.ts` or `src/data/shoppingMerge.ts`. `.claude/agents/developer.md` still says Expo SDK 54 / RN 0.81.

12. **Process failures worth knowing.**
    - #352's work order had a German-only unit map although the existing parser handles English measures. I read that work order before dispatch and did not see it. That one gap cost the issue.
    - Developers ignored two instructions several times: three read a test exit code through a pipe, and two edited files with `sed` or `node` instead of the edit tool (#348, and #338's second round for a proof that was never committed). The testers checked the affected diffs for CR and mojibake and found none.
    - The #339 tester and developer disagree on how the reader tests failed before the code (a `TypeError` on a missing function, or assertions against stubs). The tester also read the full-suite totals through `grep`; the exit code 0 for that tip is the developer's and mine at the merge.
    - #339's CSV round trip, #338's file handling and #348's race test ran on sql.js and in-memory mocks only.
    - Every work order ran well past the 400-word limit in the analyst's instructions (670 to 1480 words). For features I had asked for more.
    - The #352 round-1 tester ended with a background test run still alive; it reported stopping it. Later testers were told to leave no process running and confirmed it.
    - My state helper failed once on a shell quoting error before anything was written; I switched to patch files. No transition was lost.
    - Two lane branches exist for lane D: `sprint/lane-d-recipes-442-443` (what merged) and `sprint/lane-d-recipes` (the same plus the parked #352).

---

## 7. Before the PR

Run from `sprint/auto-fixes` on the phone, in Expo Go. All unticked; tick them yourself. No check needs edited code, a preview build or a notification.

- [ ] **Cold review:** a fresh Claude Code session with none of this sprint's context runs `/code-review` on `main...sprint/auto-fixes`.
- [ ] **CI on the tip:** the GitHub `test` check on the tip of `sprint/auto-fixes` is green (it was on `7d2cbcf`; the report commit follows it).
- [ ] **Decision on #452** (§6, item 1) before #442's wording ships.
- [ ] **#344 (do this first, it runs migration v39 on your real database):** launch the app with your existing data: it starts normally and earlier sets are still listed. Open a lift's set logger, log one Warm-up and two Working sets for one exercise. The warm-up row shows a "Warm-up" label, the working rows do not. Open Analytics: that exercise's PR and progression ignore the warm-up. Reopen the logger: the toggle is back on Working.
- [ ] **#337:** open the logger for an exercise you logged on an earlier day. The line shows that session's last working set (not a warm-up), and tapping it fills both fields. An exercise you never logged shows no line.
- [ ] **#342:** the Analytics weight card shows faint dots and a smooth solid line, and the kg/week figure has the sign you'd expect from your last two weeks. Toggle 30 days / 90 days: the line must not restart at the left edge.
- [ ] **#444:** cook one portion of a recipe, assign it to two slots and tick both. Removing the second one shows the text without the inventory sentence. Removing the first shows the old text.
- [ ] **#347:** add two recipes that share an ingredient (for example two with olive oil or garlic cloves). The list shows one line with the summed amount, under its section.
- [ ] **#348:** plan Lunch on day 1 and on day 2 (a different recipe), then copy day 1's lunch to days 2, 3 and 4. Expect "Copied 2 meals. Skipped 1 already planned.", days 3 and 4 filled and unticked, day 2 unchanged. Check that the "Copy day to…" pill sits properly in the day card. Then open Log Cooked Meal: your usual recipes are under "Often cooked" at the top, each once.
- [ ] **#338:** after a start, Settings lists one automatic backup. Share opens the share sheet. Restoring it works and your data is still there. Open Settings once on a fresh install or after clearing data, before any backup exists: the list shows the empty-state sentence, not an error.
- [ ] **#339:** tap "Export as CSV", save the three files and open `meals.csv` in Google Sheets. Umlauts and recipe names with commas are intact. On Android, the three share sheets appear one after the other.

No device check: #442 and #443 (by decision: the request limit cannot be reached on purpose in Expo Go; the 429 path, the wording and the Alert are covered by tests).
