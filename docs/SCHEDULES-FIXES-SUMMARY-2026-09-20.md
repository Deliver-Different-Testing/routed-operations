---
title: Schedules (NEW) — fix list summary and order of work
date: 2026-09-20
audience: Steve, Marcus, Kevin
status: Summary — the full brief is KEVIN-SCHEDULES-NEW-FIXES-2026-09-20.md
---

# Schedules (NEW) — what is wrong, and the order to fix it

21 items from Steve's walkthrough of the deployed new Schedules view, each grounded
in the code with a file and line, a fix and acceptance criteria.

**Full brief:** [`KEVIN-SCHEDULES-NEW-FIXES-2026-09-20.md`](KEVIN-SCHEDULES-NEW-FIXES-2026-09-20.md)
— carries the detail, the DDL, the diagnostic queries and 18 screenshots against the
items they evidence.

---

## One thing is urgent

**The Active toggle in the schedules list changes how a schedule dispatches.**

`AutoBook` means "book immediately". The Active toggle writes it. So switching a
schedule to Inactive stops it booking immediately and starts it staging into the bulk
table — where nothing becomes a job until someone builds a run. Switching it to
Active does the reverse.

Neither is what "Active" means to the person clicking it, and it is invisible
afterwards, because the list then displays `AutoBook` as the Active state. The toggle
looks like it did exactly what was asked.

It is live in the deployed view. The fix is one line today; separating Active from
Book-immediately properly is a small follow-up. There are no audit columns on that
table, so schedules already flipped cannot be identified — the only check available is
the book-immediately count against what ops expects.

---

## Five defects that cost money today

| | What happens |
| :- | :- |
| **Zone rows overwritten** | Delivery zones are read from one column and written from another, so opening a schedule and saving it destroys its zone rows. The read column is empty on 81 of 179 schedule sets. |
| **`MaxJobs` overwritten** | Hardcoded to 10000 on every save. The real value is never read back. |
| **Wrong temperature state** | A production integer is handed to a text dropdown with no mapping. The affected value covers 87 of 179 sets, including every medical schedule. |
| **Clients cannot see their own booking** | The parent job does not exist until the delivery day, and the parent is the client's entire view — every leg's status attaches to it. Every "where is my delivery?" call between booking and delivery day comes from this. |
| **Overrides clone the schedule** | Every client wanting a different cut-off adds another schedule to the 2,725 that exist. |

---

## Two structural changes

**Client overrides become differences, not copies.** Today, giving one client a
different cut-off creates a complete second schedule. Instead: one row per
(schedule, client, what-differs), against the same schedule. Three clients with three
different needs become three rows rather than three schedules. Designed to resolve in
a single index seek on the booking path, because pricing and dispatch sit on it — and
it *removes* rows from the database rather than adding them.

**The bulk table goes back to being staging.** `tblBulkJob` is a staging and
run-building area for bulk deliveries booked in advance. A job only leaves it when
someone builds a run, which is why nothing appears before the delivery day. So: the
parent job exists from the moment of booking, and a schedule that books immediately
writes no staging row at all.

---

## Order of work

### Before anything else — today, and all small

| | |
| :- | :- |
| **F21** | Stop the Active toggle writing `AutoBook`. One line. |
| **F7 write path** | Stop zone rows being overwritten on save. One line. |
| **F8** | Stop writing 10000 over the real `MaxJobs`. |
| **F17 step 1** | Get `uspPrebookSet` into version control. A nightly production job currently has no review and no history. |
| **F18** | Read it. One page, and it decides the key every other item writes. |

### Then

| Step | Item | Why here |
| :- | :- | :- |
| 1 | Parent lands at booking time | Customer-facing; waits on nothing |
| 2 | Temperature state mapping | Half the estate is wrong |
| 3 | Collection section on schedules with no collection job | One query decides the cause |
| 4 | **The override model** | One deployable slice; three other items fall out of it |
| 5 | Small view fixes — box discount, depot filter, sorting | One pass |
| 6 | **Linehaul out of the schedule** | Biggest structural win; unblocks pricing |
| 7 | Schedule shape — display name, depot settings, collection zones | |
| 8 | Cut-off rewrite + next-available-collection | The one real rewrite |
| 9 | Pricing and zones | Its own brief |
| 10 | Recurring routes | Re-count after 4 and 6 — much of it may dissolve |
| 11 | Staging bypass | Needs the read-impact counts first |

Two decisions already made: **schedule "groups" are renamed to bundles** (free now,
expensive once those tables hold data), and **everything links on the schedule header
id** — never the day-row line, never the schedule name.

---

## What is needed back

- The legacy temperature-state integer → label mapping.
- The name of the holidays table.
- Three diagnostic queries run: duplicate schedule names, day rows that disagree with
  each other, and schedules by book-immediately.
- Ops to confirm the book-immediately count looks right — the only check on what the
  Active toggle may already have changed.
- Where the collection and linehaul legs sit when a job goes straight through.

---

## Ships with the brief

Two migration scripts, both with a rollback harness that runs and reports without
committing until someone has read the output:

- **`002`** — the schedule bundle tables, and re-pointing routes at the schedule
  header.
- **`003`** — the client override table, and folding every existing cloned schedule
  into it. It refuses to fold anything that differs in ways an override cannot carry,
  and reports those for a human to decide.
