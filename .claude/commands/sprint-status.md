---
description: Report where the sprint stands, without changing anything.
---

Read `.claude/sprint-state.json` and report the current state of the sprint. **Change nothing** — no
commits, no merges, no agent dispatch. This command is read-only.

Reconcile the state file against reality before reporting:

```bash
git log --oneline --all | head -40
git branch -a | grep sprint/
```

Then report, concisely:

1. **Elapsed** — started when, running how long
2. **Progress** — `merged / ready / in-flight / parked / pending` out of the frozen scope
3. **Per lane** — status, current issue, done count, parked count
4. **Currently in flight** — which issue is at which stage, and its round-trip count
5. **Parked so far** — issue number and the one-line reason for each
6. **Integration branch** — last merge, and whether typecheck and tests were green after it
7. **Found during sprint** — new issue numbers filed, with a note that none were worked
8. **Anything that looks wrong to you** — a lane stuck on one issue for hours, a round-trip count
   climbing across several issues in the same lane, the same file conflicting repeatedly. Say so.

If `.claude/sprint-state.json` does not exist, say that no sprint has been started and stop.
