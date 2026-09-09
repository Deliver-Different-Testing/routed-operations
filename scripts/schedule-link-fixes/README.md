# Schedule/client link — fix pack

Proposed fixes for the live defects in
[`docs/STEVE-REGRESSION-REVIEW-SCHEDULE-CLIENT-LINK-2026-09-09.md`](../../docs/STEVE-REGRESSION-REVIEW-SCHEDULE-CLIENT-LINK-2026-09-09.md).

**Status: proposals, not applied.** Nothing here has been run against any
database. They follow the house convention from
`scripts/schedule-rationalisation/sql/001_*.sql` — one transaction, `@Commit = 0`
by default so a run rolls back and prints its numbers first.

The C# fixes are **not** in this pack. That code lives in GitLab, which is
read-only and not reachable from where this was written. Those fixes are
specified as code sketches in the review doc's *Suggested fixes* section, and
listed below as what has to ship alongside each script.

## Order

| Script | Finding | When | Writes |
|---|---|---|---|
| `001_capture_and_guard.sql` | B | **Before `20260908120000` on any un-migrated tenant** | Capture table only |
| `002_backfill_dayrow_clientid.sql` | 6 | After the C# fix ships | `tblBulkRunSchedule.ClientId` |
| `003_postcode_polygon_survey.sql` | A3 | **Before deciding Phase 1 scope** | Nothing — read only |
| `004_postcode_polygon_port.sql` | A1, A2, A3 | With the matching C# change | Re-keys two tables |

### 001 — capture and guard

The one genuinely time-critical item. Step 4d of `20260908120000` deletes
`tblScheduleClient` and repopulates only the 1:1 relationships, so any second
client an operator bound through the UI since 2026-08-25 is discarded — and
nothing detects it, because the post-state is internally consistent and passes
the migration's own checks.

This captures the table first and throws if it holds bindings that cannot be
reconstructed. On a tenant that has **already** migrated it is too late for the
capture; reconcile from a backup taken before the apply date.

### 002 — back-fill day-row `ClientId`

Repairs data. **Does not fix the cause** — `ScheduleService.UpsertAsync` (~539-545)
and `CopyAsync` (~727) must change to `ClientId = header.LegacyClientId` or the
null rows return on the next schedule created.

Run with `@Commit = 0` first: the affected row count dates the regression.

### 003 — survey (read only)

Sizes finding A3 before anyone commits to fixing it. Query 2 is the prune list —
each row is a name where one binding set is serving several operationally
distinct schedules. Query 4 lists already-stranded sets, which are what a future
rename would silently inherit.

Run this before the Phase 1 scope call.

### 004 — port the junctions

Re-keys `SchedulePostcode` and `SchedulePolygon` from `ScheduleName` to
`BulkRunScheduleId`.

Two things to know before reading it:

- **Sequencing correction.** The fan-out cannot precede dropping the old primary
  key. The existing PK is `(ScheduleName, PostCode)`; copying a shared set to a
  second header writes a duplicate of that pair, which the old PK forbids. The
  script drops the PK first. The review doc's prose sketch had these the wrong
  way round.
- **Disambiguation rule.** For the shared groups, the data saying which schedule
  owned which postcode does not exist — the rows were never stored separately.
  The only behaviour-preserving rule is to give every schedule sharing the name
  the whole set, then let ops prune. Nobody loses a binding; a structural
  problem becomes a tidy-up queue.

Ships with the `DespatchContext` key change and the two `SyncPostcodesAsync` /
`SyncPolygonsAsync` signature changes. After it, the rename path needs no
cascade.

**Do not ship a rename cascade as an interim fix.** With the current composite
key it collides whenever the target name already holds that postcode, and with
48 shared names it will.

## Not in this pack

| Finding | Why |
|---|---|
| 1 — UNION vs ELSE | Steve's decision first. SQL for both forms is in the review doc. |
| 3 — legacy tuple | Pure C# (`ScheduleService` 613/619, 794/800, 650-654). Sketch in the review doc. |
| 8 — `uspPrebookSet` name resolution | Needs the SP body, and Kevin's confirmation of the six line numbers. |
| 2 — naming collision | Rename across both repos; mechanical but wide. |
| 5, 7 | Documentation, a variable rename, and a release note. |

## Before running any of these

`@Commit = 0` is the default in every script that writes. Run it that way first,
read the printed counts, and only then set `@Commit = 1`. On production tenants,
take a backup regardless — 004 re-keys two tables and 001 is the only thing
standing between step 4d and unrecoverable operator work.
