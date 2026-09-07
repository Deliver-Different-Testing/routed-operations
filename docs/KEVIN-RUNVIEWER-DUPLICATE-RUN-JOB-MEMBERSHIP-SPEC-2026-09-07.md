---
title: Kevin RunViewer duplicate RNO200 run / job membership spec
created: 2026-09-07
status: Decision + fix spec for the Route 5 / RNO200 Runviewer bug report
source: Kenneth bug report (Route 5 / RNO200, NeoGenomics corridor) + Kevin investigation + Steve direction
bug_report: https://docs.google.com/document/d/1ABXBw2LE7xpQW58EyhjdfCPHjv1_ofPx/edit?usp=sharing
related_docs:
  - KEVIN-LEGACY-RUNBUILDER-FIXES-SPEC-2026-06-23.md
  - KEVIN-RUNVIEWER-OFFSETS-ADMIN-LINEHAUL-SPEC-2026-06-25.md
  - KEVIN-SCHEDULED-ROUTE-NOT-DISPATCHING-ASSESSMENT-2026-07-30.md
---

# Kevin RunViewer duplicate RNO200 run / job membership spec

## Feature overview

This spec answers Kevin's bug report on the Runviewer for Route 5 / RNO200 and turns it into an execution brief.

Kevin reported three issues and asked for one decision:

1. `RNO200` appears twice in the Run List (one `LIVE` / Dane Test `123`, one `READY` / unassigned with 7 jobs).
2. `P2891DEL` appears in the expanded job list of the `READY` / unassigned `RNO200` run even though it is assigned to courier `123`, so the row says 7 jobs and the expanded list shows 8.
3. `P2891DEL` appears under the Reno depot instead of Burbank because its location data points at Reno while its address is Burbank.

Steve's direction on reading the report:

> We should never see the same job number replicated on a run. It seems the filtering is the issue. How can a job show as assigned and unassigned at the same time?

That reframes the ask. Bug 1 is **not** primarily a naming / presentation choice. Bugs 1 and 2 are the same defect seen from two angles: the Run List and the expanded job list do not share one membership rule, so one job can land in two runs at once.

---

## Steve decisions

These are the calls for this batch:

1. **Invariant: a job number appears in exactly one run row for a given despatch date.** No job may be counted or listed in more than one run. This is the acceptance bar for the whole fix.
2. **Fix the membership rule first, not the labels.** The Run List row count and the expanded job list must be produced by the **same** predicate. Kevin's proposed Bug 2 fix is approved, with the constraint that it must be a shared rule, not a second patch on the expanded list.
3. **Bug 1 direction: Option A (keep the split by courier, label it clearly), applied only after decision 2 makes the rows disjoint.** Reasoning is in the next section. If Steve or George want Option B after seeing disjoint rows, that is a follow-on, not part of this fix.
4. **Bug 3 stays a data / booking-path investigation.** Kevin continues tracing how `P2891DEL` was created. The broader "depot filter uses location, not pickup / delivery direction" limitation is logged as a separate follow-on and is **not** folded into this fix.

---

## Why Option A and not Option B (for now)

The `LIVE` / Dane Test row and the `READY` / unassigned row are in genuinely different operational states.

`KEVIN-LEGACY-RUNBUILDER-FIXES-SPEC-2026-06-23.md` section 3 already sets the rule that **run list status must not contradict the jobs inside the run**. A single merged `RNO200` row would have to show one status for a set of jobs that are half dispatched and half not. That reintroduces the status drift that spec removed.

So the operational unit shown in the Run List stays: **route + despatch date + courier**. Two rows for `RNO200` are correct while part of the route is dispatched to a courier and part is still unassigned. What is wrong today is that the two rows overlap. Once they are disjoint, a clear label removes the operator confusion at near-zero cost.

Option B remains open as a later UX change once the data underneath is trustworthy. Do not build it in this batch.

---

## 1. Root cause to confirm: two different "unassigned" rules

Kevin's finding is that the Run List and the expanded job list apply different rules when deciding which jobs belong to an unassigned run. That is the whole bug. Kevin must pin down the exact divergence and write it down before changing code.

### Likely places the two rules differ

Check each of these against the actual Runviewer code and SPs. Any one of them produces the observed 7 vs 8 mismatch:

| Candidate divergence | Run List (count) side | Expanded job list side |
|---|---|---|
| Courier key normalisation | groups on the raw courier value | treats `NULL`, empty string, `0`, or an unknown / test courier code as "unassigned" |
| Courier lookup | uses the courier field on the job row directly | joins to `tucCourier` / fleet and drops or reclassifies jobs whose courier does not resolve or is not in the selected depot's fleet |
| Run key | groups on route name + despatch date + courier | queries on route name + despatch date only, then filters out jobs whose *run* is `LIVE` rather than jobs whose *courier* is set |
| Status vs assignment | "unassigned" means no courier | "unassigned" means not yet dispatched (`READY`), which is a status test, not an assignment test |
| Source table | reads a run-level rollup (e.g. a `tblBulkRun`-style header or an SP rollup) | reads job rows (`tucJob`) live |

The bug report says `P2891DEL` is assigned to courier `123` yet lands in the unassigned expanded list. That points at either the courier-normalisation row or the status-vs-assignment row above. Confirm which.

### Minimum output Kevin should produce during implementation

A short truth table, the same way the run-status fix was handled:

| Predicate | Run List today | Expanded list today | Agreed single rule |
|---|---|---|---|
| job is unassigned when | ? | ? | ? |
| job belongs to run `X` when | ? | ? | ? |
| courier value treated as "no courier" | ? | ? | ? |

Without this table the fix is guesswork and will drift again.

---

## 2. Required single membership rule

Define one function / one SP predicate that answers: **which run does this job belong to?** Both the Run List aggregation and the expanded job list must call it.

### Run key

For a given despatch date, a run row is identified by:

- route / run name (`RNO200`)
- despatch date
- normalised courier key

### Normalised courier key

Kevin must define one normalisation and use it everywhere:

- a job has a courier when the courier field resolves to a real courier identifier
- `NULL`, empty string, whitespace, and any legacy placeholder value all normalise to **unassigned**
- a courier code that is present but does not resolve to a `tucCourier` row is **still assigned** for membership purposes (it belongs to that courier's run, not to the unassigned run); surface it as a data problem, do not silently reclassify it

The last point matters for this exact report: `123` is a real test courier (Dane Test). Whether or not it is in the Reno fleet, a job carrying `123` must never be shown as unassigned.

### Status is not membership

`LIVE` / `READY` is the run's **status**, derived from or reconciled with the jobs inside it per the legacy fixes spec. It must not be used as the test for whether a job is in the unassigned run. Assignment is a courier test. Dispatch state is a status test. Keep them separate.

### Where the rule should live

Preferred: one server-side query / SP that returns job rows already stamped with their run key, and the Run List rows are a `GROUP BY` over that same result. The expanded list is then a filter on the same rows by run key. That makes the count and the list structurally unable to disagree.

Acceptable fallback if the legacy structure makes that expensive: one shared client-side membership function used by both the run rollup and the expansion, fed by the same job payload. Do not keep two independent queries with two independent `WHERE` clauses.

---

## 3. Bug 1: Run Name labelling (Option A)

Once rows are disjoint, label each `RNO200` row so operators can tell them apart without expanding:

- courier-assigned row: `RNO200 (Dane Test)` or `RNO200 - 123 Dane Test`, whichever matches existing Runviewer courier display conventions
- unassigned row: `RNO200 (Unassigned)`

Rules:

- the base route code stays first so sorting and searching by `RNO200` still work
- the suffix is display only; do not write it back to the stored run / route name
- if the same route has two different couriers on the same date, that produces two labelled courier rows, which is correct
- the `From` / `To` columns can stay identical across the rows; the label and status carry the difference

---

## 4. Bug 2: expanded list must match the row count

This is a consequence of section 2, not separate work. Acceptance is:

- the `READY` / unassigned `RNO200` row shows 7 jobs and expands to exactly those 7 jobs
- the `LIVE` / Dane Test `RNO200` row includes `P2891DEL` and only jobs carrying courier `123`
- `P2891DEL` appears in exactly one run row for that date

Kevin's proposed fix for this is approved provided it is implemented via the shared rule in section 2 rather than a second filter added to the expansion only.

---

## 5. Bug 3: `P2891DEL` under Reno instead of Burbank

### Status

Investigation continues. No decision required yet.

### What Kevin should bring back

1. How `P2891DEL` was created (booking path, user, source) compared with `P2893DEL` and `P2894DEL`, which are correct.
2. Which field holds the Reno location reference while the address text says Burbank, and which step should have updated it when the route was built.
3. Whether the same defect exists on any other job on Route 5 today.

### Follow-on, not part of this fix

Kevin's additional finding stands: the Runviewer depot filter keys on the job's location without knowing whether that location is the pickup or the delivery point. Log this as a separate Runviewer follow-on with its own spec. It changes depot-filter semantics for every route and must not ride along with the membership fix.

Also note for the record: recurring-route runs such as `RNO200` are currently excluded from the Outbound view altogether. Kenneth's observation that Outbound should not show this run is correct in effect, but for that reason rather than because of direction filtering.

---

## Database / code surfaces

The Runviewer source is in the separate `runviewer` repo (referenced in `KEVIN-RUNVIEWER-OFFSETS-ADMIN-LINEHAUL-SPEC-2026-06-25.md` as `gitlab-source/runviewer/wwwroot/app/components/...`). Kevin owns locating the exact files; the areas to inspect are:

| Area | What to look for |
|---|---|
| Run List data source | the SP / query that produces one row per run with a job count and courier; confirm its `GROUP BY` and its courier predicate |
| Run expansion data source | the SP / query / client filter that produces the job list for a selected run; confirm its run key and courier predicate |
| Courier normalisation | any place that maps courier `NULL` / empty / placeholder / unknown to "unassigned" |
| `tucJob` | live job rows; courier field, run / route name field, despatch date, status |
| `tucCourier` | courier `123` (Dane Test) and how the Runviewer resolves courier display names |
| Depot filter | the location-based depot predicate (Bug 3 follow-on only; do not change in this batch) |

---

## Recommended implementation order

1. Write the predicate truth table in section 1 from the real code and SPs.
2. Define the single membership rule (section 2) and implement it once.
3. Point the Run List aggregation and the expanded job list at that one rule.
4. Verify on the Route 5 / RNO200 data that rows are disjoint and counts match.
5. Apply the Option A labels (section 3).
6. Report back on the `P2891DEL` booking-path trace (section 5).
7. Raise the depot pickup / delivery direction limitation as a separate follow-on.

---

## Key questions answered

### How can a job show as assigned and unassigned at the same time?

Because two different code paths decide membership with two different predicates. The Run List count uses one idea of "unassigned"; the expansion uses another. `P2891DEL` satisfies the second but not the first, so it is counted in the `LIVE` row and listed in the `READY` row. Section 2 removes the second predicate.

### Should there be one `RNO200` row or two?

Two, while the route is partly dispatched and partly unassigned, because those are different run states and the Run List status must stay truthful to the jobs inside. Label them (Option A). Revisit Option B only after the rows are disjoint.

### Is the split by courier itself the bug?

No. The split is correct data. The overlap between the split rows is the bug.

### Does the depot / direction finding change this fix?

No. It is a real limitation but a separate one. Keep it out of this batch.

---

## Testing checklist

1. Load the Route 5 / RNO200 despatch date in the Runviewer.
2. Confirm exactly two `RNO200` rows: one labelled for Dane Test / `123`, one labelled Unassigned.
3. Confirm the unassigned row count equals the number of jobs in its expanded list.
4. Confirm the Dane Test row count equals the number of jobs in its expanded list.
5. Confirm `P2891DEL` appears only in the Dane Test row.
6. Confirm no job number appears in more than one run row for that date (run the check across every run on the date, not just RNO200).
7. Assign one of the 7 unassigned jobs to courier `123` and confirm it moves rows and both counts update with no overlap.
8. Unassign it again and confirm it moves back cleanly.
9. Confirm a courier code that does not resolve to a `tucCourier` row still keeps its job out of the Unassigned row and is visibly flagged rather than reclassified.
10. Confirm the run status per row still reflects the dispatch state of the jobs inside it, per the legacy fixes spec.
11. Confirm the depot filter behaviour is unchanged by this batch.
