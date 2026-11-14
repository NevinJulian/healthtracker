# Sprint report: `sprint/auto-fixes` (sprint 6)

Autonomous sprint, started 2026-11-14 at about 14:00 UTC from `main` `4dd49ae` (Expo SDK 58), finished at about 15:05 UTC in one session. Frozen scope: the 7 open issues in `.claude/SPRINT.md` §3, the second feature sprint. The orchestrator only dispatched work, judged it, merged lanes and recorded state. Developer agents wrote every line of code, and tester agents checked every change adversarially. Security agents reviewed every change that reached `src/db`, the backup and restore path, `src/api` or external input; the one skip is recorded in §2.

The state file found at start was sprint 5's (finished, older than 24 hours) and no `sprint/auto-fixes` branch existed, so sprint 6 started fresh.

**Nothing has been merged to `main`, and no PR has been opened.** The PR waits for the cold review and the device checks in §7.

---

## 1. Outcome

All 7 issues landed on `sprint/auto-fixes`, and all four lanes are merged. **Nothing was parked.** No abort condition was hit. The integration branch is green: typecheck clean, 2746 tests in 153 suites (baseline on `main` 1843 / 131), and the GitHub `test` check is green after every lane merge that was pushed.

#352 (import a recipe from a URL), parked at the end of sprint 5, landed on the last allowed round:

- **#352** was rejected twice by the tester, both times for the same class of defect that parked it in sprint 5: a confident wrong quantity on an ingredient line. Round 1's rule only looked at the first two words of the name. Round 2 still read "1 cup flour, plus a tbsp" as 240 g. Round 3 was approved after a probe corpus of about 1,240 real ingredient lines found no wrong quantity left.
- **#351** went back once: the card hid the suggested goal when it was within 10 kcal of the current goal, where the decision only hides the Apply button.
- **#447, #346, #451, #454 and #450** passed the tester on the first round.

One migration was added: v40, the `food_log` table and its date index. `src/db/schema.ts` differs from `main` by 13 added lines and no removed lines; no existing migration was touched.

**Read before merging:**

- **#346's weekly review notification is on by default, but the app never asks for notification permission unless a Settings reminder toggle is used** (#465). On Android 13+ and iOS, a user who never touched those toggles will not get it. Decide #465 before or right after this merges.
- **#346 changes the startup path in `App.tsx`** to route a notification tap. Jest can't see a native crash there; the SDK 57 notifications crash was invisible to both jest and CI. The #346 device check opens the app; do it.
- **Several rulings of mine** filled gaps the decisions left (§6). They are the orchestrator's picks, not the owner's.

3 issues were filed during the sprint (§4), and #464 collects 20 small findings. None was worked.

---

## 2. Merged

Lane merges into `sprint/auto-fixes` (regular merge commits): A `bf16d7a`, C `eec95fb`, D `158738d`, B `3076717`, then the docs branch `e70dac5`. None had a conflict. Lane D started with a merge of the parked sprint 5 branch (`945399f`), which had one predicted conflict in `RecipeEditorScreen.tsx`; the `conflict` agent took the lane side, and the file differs from the integration branch only by the draft helpers.

| Issue | Title (short) | Lane branch | Commits | What the tests assert |
|---|---|---|---|---|
| #447 | Quick add: calories and macros without a recipe | `sprint/lane-a-foodlog` | `339a12d` `76c2a9c` `8c406fb` `ef1d12d` `43584c1` `de43228` `bf17cd2` `4700619` `33ee1b1` (tests) · `0ccf030` `608ced4` `fa8dcae` `8f6c700` `3d8fbb9` `081efe3` `ad5c134` `44ef5f6` `cfaf04a` `ef94a1a` `6bcdf82` · cleanup `f19b15d` | v40 creates `food_log` and `idx_food_log_date` and records version 40; `getConsumedMacrosByDay` = consumed meals + entries, an entries-only day appears with `mealCount 0`, the window excludes older entries; `getAverageConsumedMacros` and plan adherence are unchanged with entries; writers validate (calories 0 < x ≤ 5000, macros 0–500, label ≤ 60, "1,5" = 1.5, "1e3" rejected) and update/delete only their row; a backup round trip keeps the entries with ids, and a backup without a `food_log` key empties the table; `food_log.csv` is the fourth shared file with header, date/id order, BOM, CRLF and the formula guard; Today lists entries below the meal plan, "+ Quick add" is always there, add/edit/delete with a confirm, 7 day chips; Meal Prep's pill and footer include the day's entries. 63 tests fail before the feature code. Security: approved. |
| #346 | Weekly review digest | `sprint/lane-b-review` | `be59a92` (neutral skeletons) `c56be60` `af90250` `3374d97` `615be7d` `a8007aa` `cc26f6c` `fdf3fc6` `eda4feb` (tests) · `51e8bdf` `79ca9f9` `5d1859f` `270c151` `c28e6ab` `4ae2649` `38c4216` `4b82822` `5f1764b` `ae5ab11` `4bf8c88` | Windows are the last 7 local days and the 7 before (month, year and DST boundaries); gym done of non-rest days, walks of 7; working sets and tonnage without warm-ups; a new best must be strictly heavier than every working set before the window, so ties and first sessions are not bests; mean calories and protein over days with meals or entries; the weight rate is the Analytics card's; "Nothing logged in these 7 days." and per-section empty lines; no judgement words or good/bad colours; the notification is weekly, on by default, Sunday 19:00, identifier `weekly-review`, idempotent in reconcile; a tap opens the screen once the navigator is ready (including a cold start) and is dropped on startup failure, render-crash recovery and onboarding, never replayed after Retry; Settings toggle, day and time like the backup reminder. 84 tests fail on the skeletons. Security: approved. |
| #351 | Adaptive TDEE from energy balance | `sprint/lane-c-expenditure` | `47cf24c` `bde1316` `fb7653f` (tests + stubs) · `8b880b1` `fc0c176` `6b62204` `2cc8fb6` `b3be8b7` `77d9275` · round 2 `4ded075` `b3a8b4a` `2b543b6` | Steady weight, linear loss (0.1 kg/day on 2500 → 3270), linear gain (0.05 kg/day on 3000 → 2620), missing days, noisy weight, days under 1000 kcal; every threshold on both sides (13/14 logged days, 9/10 weigh-ins, 70 %/130 % of the formula TDEE, the ±10 % bound, the 10 kcal deadband, day 6/7 after Apply, the 1000 floor); today never counts; the card shows estimate, formula TDEE and inputs, the reason and progress when there is no estimate, the suggestion line always and Apply only outside the deadband and the 7-day wait; Apply confirms and writes only the calorie goal and the date in one transaction; the writer rejects non-integer, out-of-range and malformed input; `suggestGoals` output is unchanged. 52 tests fail before the feature code. Security: approved (two rounds). |
| #352 | Import a recipe from a URL | `sprint/lane-d-import` | sprint 5 (merged in at `945399f`): `45dbb7c` … `a355753`, 21 commits · sprint 6: `5ba8738` `ea8e626` · `1e462ae` `070235e` `92fabc7` `b8d3a3d` `43abd32` · `22e6c12` `593d786` · cleanup `4e678d6` | Every probe line from sprint 5's three rounds and sprint 6's three rounds is a literal row: a modifier between the number and a unit ("1 heaped tsp sugar", "1 (heaped) tsp salt", "1 level-tsp salt", "1 slightly heaped tsp salt"), each-words ("1 tsp each salt and pepper", "1 TL jeweils Salz"), unlisted abbreviations ("1 Teel. Salz"), a second measure later in the name ("1 cup flour, plus a tbsp", "1 EL Mehl und ein TL Zucker"), all name only; "250 gr butter" is 250 g, "250g/9oz plain flour" is 250 g, "500 g Mehl Type 405" keeps its number in the name; containers stay name only; keep-count guards stay ("2 Stangen Lauch", "1 can (14 oz) tomatoes"). The fetch, JSON-LD and editor-draft tests come from sprint 5. 29, then 33, then 11 rows failed before each round's fix. Security: approved all three rounds (no ReDoS; 40,000 hostile lines). |
| #451 | Recipe editor read-only while a save is pending | `sprint/lane-d-import` | `aa0e52c` `4b89e9d` (tests) · `4380268` | Save → 1 s → Recompute starts no new lookup and saves the first run's macros; typing during the save changes nothing; every control is disabled during the save and under the "Saved" Alert and released on answer; a failed save re-enables them; the existing overlap test now expects the same edit-during-save to be ignored (see §6). 5 tests fail before the fix. Security: skipped (UI only, no data path). |
| #454 | Volumes of dry goods converted at their own density | `sprint/lane-d-import` | `1655dc1` (tests) · `e09af67` `6d104a4` `2533e03` `4ccdefc` `5146104` `4d67b1a` | Each table entry as a cup, a tablespoon and a teaspoon; German names, compounds ("Weizenmehl", "caster sugar", "cornflour"), longest keyword wins ("brown sugar" 210, "Paniermehl" 110); "rice vinegar" and "butter lettuce" don't match; liquids unchanged; "2 floz" 59.14 ml; "1,5 kg" 1500 g, "1,000 g" 1000 g, "0,125 l" 125 ml; "1 pinch" 0.5 g; EL/TL in any case; "1 1/2 cups flour" through the URL import gives 187.5 g. 15 existing expected values change, exactly the ones the work order listed (old → new checked by hand). 56 tests fail before the fix. Security: light check, approved. |
| #450 | Ingredients without a quantity | `sprint/lane-d-import` | `2682526` (tests) · `bc58ff0` `32b5673` `0d833b5` | Two name-only adds in different units give one line; a name-only add onto an open line with an amount adds nothing; an amount onto an open name-only line gives it that amount and unit; a checked line is never merged into; the recipe detail shows a quantity-0 ingredient by name only at 1 and 4 servings; the shopping row shows only the name. 7 tests fail before the fix. Security: approved. |

Cleanup: lane A `f19b15d` (comments only), lane D `4e678d6` (one unused regex, one moved constant, one test title), lanes B and C no changes. A docs branch (`905782a`, `67303ed`) brings `CLAUDE.md` up to date: migrations end at v40, four CSV files, quick-add totals, name-only shopping lines, the density table, the weekly review drawer entry and tap, the URL import's network fetch, and the new screen suites.

---

## 3. Parked

None.

The closest call was **#352**, which used all three rounds. If round 3 had failed, the stall was precise: the line parser kept finding new free-text forms that produced a wrong quantity. The bar the owner set ("a wrong quantity is a defect, a name without a quantity never is") is what made it finish, because every round's fix could err towards name-only. The cost of that bias is in §6, item 2.

---

## 4. Found during sprint

Filed, labelled `found-during-sprint`. **None was worked.**

- **#465**: the weekly review notification is on by default, but permission is only ever requested from a Settings toggle, so users who never used one won't get it. Needs a product decision (when to ask).
- **#466**: the density table misses common names: "cocoa", "cacao", "Kakaopulver"; "cooked rice" gets the uncooked density.
- **#464, Sprint 6: small findings**, 20 checkboxes: the Settings CSV text still says "three spreadsheet files"; a throw from the "Saved" Alert would leave the editor locked; the line-parser invariants test can't see a partly renamed name; restore doesn't range-check `food_log` values; `BioForceModal` raw values; quick-add limits defined twice; `getConsumedMacrosByDay(days)` covers `days + 1` days; the Settings calorie stepper can overwrite an applied adaptive goal; "1 tbsp; olive oil" keeps the semicolon in the name; a double tap on Save within one frame; a restored calorie goal has no upper bound; the adaptive apply date across midnight; `getAdaptiveTdeeAppliedOn` only pattern-checks; `parseMeasure` can return `Infinity` on the Discover path; `ALIAS_MAP` prototype keys; a mildly slow range regex; a stated gram weight in brackets is ignored; `parseMeasure` doesn't know dl or cl; the weekly review toggle flickers on first load; the review screen reads the whole set history on every focus.

---

## 5. Integration branch state

- **Branch:** `sprint/auto-fixes`. The last commit that changes code is the lane B merge `3076717`; the docs merge `e70dac5` changes only `CLAUDE.md`; state and report commits follow.
- **typecheck:** pass at `e70dac5` (exit 0).
- **tests:** 2746 passed / 2746, 153 suites at `e70dac5`, with `--maxWorkers=2`, exit 0. The baseline on `main` `4dd49ae` was 1843 / 131. After each merge: A 1944 / 136, C 2016 / 139, D 2639 / 146, B 2746 / 153. Each step is exactly the previous total plus the lane's own suites and tests.
- **`src/db/schema.ts`:** 13 lines added against `main`, none removed: the v40 entry (`CREATE TABLE IF NOT EXISTS food_log …` and `CREATE INDEX IF NOT EXISTS idx_food_log_date ON food_log(date)`).
- **GitHub CI `test` check:** success on `56ecae3` (lane A), `7af8dd0` (+C) and `e21796f` (all four lanes). Lane D's merge was pushed together with lane B's. The docs merge `e70dac5` was still running when this report was written; it changes only `CLAUDE.md`.
- **Size:** 97 files changed, +9252 / −102 against `main` (state file and report excluded). 100 commits besides merges and state commits, 21 of them the sprint 5 #352 work.
- **Changed outside `src/`:** `App.tsx` (#346 tap routing), `__mocks__/expo-notifications.js` (+5 lines, three jest.fns for the tap API, additive), `CLAUDE.md`.
- **Not changed:** `package.json`, `package-lock.json`, `app.json`, `eas.json`, `babel.config.js`, `jest.config.js`, the workflows. So `build-check.yml` will not run on the PR, and no native dependency moved.
- **Note on timezones:** `npm test` is `cross-env TZ=UTC jest`, so every local run was UTC, on Windows. The #346 tester also ran the review helpers under four other timezones. CI runs Linux.
- **Left on disk:** the lane worktrees `C:/git/ht-lanes/lane-a` … `lane-d` and the work orders in `C:/git/ht-lanes/wo/`. All lane branches and `sprint/docs` are pushed.

**Opening the PR.** This uses the GitHub MCP, as the sprint protocol requires; the `gh` CLI is not used. Do this only after §7 is fully ticked. Call `mcp__github__create_pull_request` with:

```
owner: NevinJulian
repo:  healthtracker
base:  main
head:  sprint/auto-fixes
title: Sprint 6: quick add, weekly review, adaptive TDEE, recipe URL import, editor lock, dry-goods densities, name-only ingredients
body: |
  Autonomous sprint 6. See SPRINT_REPORT.md on the branch for per-issue tests, round trips and the review list.
  Merge with a regular merge commit, never squash.

  Closes #346
  Closes #351
  Closes #352
  Closes #447
  Closes #450
  Closes #451
  Closes #454
```

If you decide #465 must be fixed before the weekly review ships, change `Closes #346` to `Refs #346` and keep the notification work out of the release notes until #465 is done; the code itself is not harmful without it.

---

## 6. What I would not merge without reading

1. **`App.tsx` (#346).** The tap routing sits on the startup path: a `navigationRef`, a tap held until `onReady`, a `NavigatorLifecycle` child that detects a crashed navigator, a listener subscribed on mount. The tester read it line by line and every case is tested, but this is exactly where SDK 57's notification crash lived, invisible to jest and CI. Read the diff, and open the app in Expo Go from a cold start.
2. **`src/nutrition/parseIngredientLine.ts` (#352).** It grew over six rounds across two sprints, and every fix leaned towards "name only". Real lines now lose counts they could have kept, e.g. "2 medium potatoes (about 1 lb)", "3 eggs in shell", "1 (14 oz) can tomatoes", "2 Mozzarella (125 g)". That is what the bar asks for, but you should see how conservative it is. Two of the rules are my rulings, not the decision's: `gr` means grams only from 10 up (below that, "1 gr. Zwiebel" is "große"), and a second measure after `/` is dropped only after a mass unit. **`ea8e626` is one commit for four rules**: asking the developer to split it needed a force-push, which this session's permission settings blocked, so it stays coarse. Every later commit was split before its first push.
3. **`src/nutrition/ingredientDensity.ts` and `parseMeasure.ts` (#454).** Three rulings of mine: (a) I rejected the analyst's "English keywords match whole words only" and kept the decision's "or the end of the last word" for every keyword, so "cornflour" matches flour (good) and "licorice" matches rice (harmless, but wrong); (b) the name is cut at the first comma before matching ("flour, sifted" matches); (c) a thousands comma needs a leading digit 1–9, so "0,125 l" stays 125 ml instead of 125 l as a literal reading of the decision would give. The decision's own thousands rule reads a European "1,234 kg" as 1234 kg; that is the decision's choice, and "1,5 kg" (the common form) is right. Coconut flour gets 125 g per cup (real: about 115).
4. **Restore now deletes data on purpose (#447).** Restoring a backup made before v40 empties `food_log`, as decision 6 says ("a restore brings back the backup's state"). It runs inside the restore transaction, after the pre-restore safety snapshot, so it is recoverable. It is still the first restore path that deletes rows a backup doesn't mention.
5. **Edits to existing tests, all authorised by me, each in its own commit or listed in a work order:**
   - #451 `4b89e9d` rewrote the first test in `RecipeEditorScreen.overlap.test.tsx`. It asserted that an edit during a pending save starts a new lookup run, which is what the decision removes. Same setup and steps, new expectations. It still fails before the fix.
   - #346 `4bf8c88` turns the weekly review off in `autoBackupRoundTrip`'s fixture before the backup is taken, because the default-on reminder makes the post-restore reconcile write one more `app_state` row (`weeklyReviewNotificationId`). The assertion is untouched, and a new test pins the default-on case. The intermediate commits `5d1859f` … `ae5ab11` are probably red on that test, which matters if you bisect. `notifications.test.ts` counts went from 6 to 7 for the same reason.
   - #447 `76c2a9c` finds migration v39 by version instead of "last".
   - #454 changed 15 expected values from 1 ml = 1 g to the density table, all in `6d104a4`.
   - Mock factories in about 30 screen suites gained the new database functions, and nothing else.
6. **`__mocks__/expo-notifications.js`** gained three jest.fns. `CLAUDE.md` warns about these mocks; the change is additive only.
7. **`CLAUDE.md`** was edited by a cleanup agent to describe the sprint's features. Read it: it is what every future agent will believe.
8. **Picks the decisions didn't make**, listed so you can overrule them:
   - #447: sheet title "Quick add", button "+ Quick add", chips "Today" / "Yesterday" / "Mon 9" (en-GB), fields "Label (optional)", "Calories (kcal)", "Protein (g)", "Carbs (g)", "Fat (g)", Save reads "Update" while editing, Delete Alert "Delete entry?", empty text "No entries for this day.", the sheet imported by path (not through `src/components/index.ts`, which no lane owns). Meal Prep now rounds the whole day total, so recipe-only days that used to show fractional kcal are rounded too.
   - #346: drawer "Weekly review" with `calendar-number-outline`; header "Last 7 days · 8 Nov – 14 Nov" / "Previous 7 days · 1 Nov – 7 Nov"; rows "Gym sessions 3 of 5", "Walks 4 of 7", "Working sets", "Tonnage 5,300 kg", "Mean calories", "Mean protein", "Days logged", "Goal 2,400 kcal · 160 g"; changes "+2 sets", "−1250 kg", "no change", "—" when the previous window had none; Settings subtitle "A summary of the last 7 days on your chosen day"; "logged before the window" means at least one working set; a day with no `daily_log` row is neither planned nor done.
   - #351: card title "Energy expenditure", first in Nutrition; "Formula estimate: {F} kcal/day"; "Logged days: N of 28 (M left out, under 1000 kcal)"; "Need 14 logged days. You have 9."; "Far from the formula estimate. Usually meals are missing from the log."; "Suggested goal {S} kcal (now {G})", shown whenever there is a suggestion (my ruling, from decision items 8–9); Alert "Change calorie goal?"; "Apply is available again on {date}"; input rows shown only with an estimate or the out-of-range case; the writer accepts 1000–10000 kcal.
   - #352: everything in item 2.
   - #450: with duplicate open lines in an old database, the first same-key line in id order takes the amount.

---

## 7. Before the PR

Device checks, from `C:/git/ht-lanes/wo/<issue>.md`, in Expo Go via the QR code from `sprint/auto-fixes`:

- [ ] **#447** (decision 9): On Today, add "Snack" with 250 kcal and 10 g protein. It shows below the meal plan, and the Meal Prep card for today shows 250 kcal more. Edit it to 300 kcal, then delete it. Add one for Yesterday with the chip: it doesn't show on Today, and the sheet lists it under Yesterday. Export as CSV and open `food_log.csv` in Google Sheets.
- [ ] **#346** (decision 9): Open "Weekly review" from the drawer. The two ranges are the last 7 days and the 7 before, and the figures match what you logged this week. In Settings, turn the weekly review off and on and change its day: no error. The notification tap is covered by tests only. **Also open the app from a cold start once and check it reaches Today** (the startup path changed).
- [ ] **#351** (decision 11): Analytics shows the Energy expenditure card. With too little data it names the missing input and how far along it is. With enough data, the mean intake and the weight change look like your last four weeks. If it offers Apply, apply it: Settings shows the new calorie goal, and the card shows when Apply comes back.
- [ ] **#352** (sprint 5 item 9 and sprint 6 item 8): Import a recipe page from a big recipe site you use. The editor opens with title, ingredients, steps and servings, and saving computes macros. A news article URL shows "This page has no recipe data the app can read." Import one German recipe page (for example fooby.ch or chefkoch.de): its ingredients come through with sensible amounts or with none, never a wrong one. Check any line with "gestrichen", "gehäuft", "Pk." or "gr".
- [ ] **#454** (decision 7): Import by URL an American recipe that measures flour in cups (for example from allrecipes.com). The editor shows about 125 g per cup of flour, not 240 g.
- [ ] **#450** (decision 5): Open a recipe with an ingredient without a quantity (a Discover import with "to taste", or a URL import with a name-only line). It shows by name only. Add it to the shopping list: the line reads "Salt", not "Salt 0 g". Then add a recipe that has salt in grams: the same line now shows the grams.
- [ ] **#451**: no device check (decision 5). A save that waits on a slow lookup can't be produced on purpose in Expo Go; the tests cover it.
- [ ] **Cold review**: a fresh Claude Code session with none of this sprint's context runs `/code-review` on `main...sprint/auto-fixes`.
- [ ] **Decide #465** (permission for the default-on weekly review) before or right after merging.
