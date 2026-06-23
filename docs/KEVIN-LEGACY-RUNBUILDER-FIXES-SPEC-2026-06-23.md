---
title: Kevin legacy RunBuilder / RouteViewer fixes spec
created: 2026-06-23
status: Initial screenshot-driven fix spec
source: Steve screenshot review
related_docs:
  - HANDOVER-KEVIN-ROUTED-OPERATIONS-2026-06-23.md
  - ROUTEBUILDER-STAGE1-RUNBUILDER-PARITY-BUILD-PLAN-2026-06-20.md
---

# Kevin legacy RunBuilder / RouteViewer fixes spec

## Claude Code steps

```bash
cd /data/.openclaw/workspace/routed-operations
ls -la docs/KEVIN-LEGACY-RUNBUILDER-FIXES-SPEC-2026-06-23.md
ls -la wwwroot/app/components/home/homeControl.js
ls -la wwwroot/app/components/home/homeView.html
ls -la wwwroot/app/components/home/tpls/pickDateForm.tpl
ls -la Models/Repository/JobRepository.cs
ls -la Models/TblBulkRun.cs
ls -la Models/TblBulkJob.cs
ls -la Models/UTL_stpJob_tblBulkRunWithFilterResult.cs
ls -la Models/UTL_stpJob_tblBulkJobWithFilterResult.cs
```

## Table of contents

1. [Feature overview](#feature-overview)
2. [Architecture: what's built vs what developer needs to do](#architecture-whats-built-vs-what-developer-needs-to-do)
3. [Step-by-step checklist](#step-by-step-checklist)
4. [Database tables](#database-tables)
5. [Key questions answered](#key-questions-answered)
6. [API endpoints summary](#api-endpoints-summary)
7. [Frontend components](#frontend-components)
8. [Testing checklist](#testing-checklist)

## Feature overview

This is the **initial** legacy-fixes batch based on Steve's first annotated screenshot.

Issues captured so far:

1. **Filter date should default to today** in the legacy RunBuilder / RouteViewer workflow.
2. **Run status shown in the run list must correctly reflect dispatch state** and be reconciled against the jobs inside the run.
3. The second issue needs a proper trace of **where run status originates** today and where it drifts from job dispatch status.

This doc is intentionally written as a Kevin execution brief, not just a note dump.

## Architecture: what's built vs what developer needs to do

### ✅ Already built / already located

| Area | File | Status |
|---|---|---|
| Filter date model | `wwwroot/app/components/home/homeControl.js` | Found |
| Filter date popup UI | `wwwroot/app/components/home/tpls/pickDateForm.tpl` | Found |
| Date button in header | `wwwroot/app/components/home/homeView.html` | Found |
| Run status persistence on bulk run | `Models/TblBulkRun.cs` | Found |
| Job status persistence on bulk job | `Models/TblBulkJob.cs` | Found |
| Run fetch result shape | `Models/UTL_stpJob_tblBulkRunWithFilterResult.cs` | Found |
| Job fetch result shape | `Models/UTL_stpJob_tblBulkJobWithFilterResult.cs` | Found |
| Send-live path passing run status into legacy commit SP | `Models/Repository/JobRepository.cs` | Found |
| Run save/update path persisting status | `Models/Repository/JobRepository.cs` | Found |

### 🔧 What developer needs to do

| # | Priority | Est. | Task |
|---|---|---:|---|
| 1 | P1 | 1-2h | Verify and harden "default date = today" behaviour on initial load and when opening the date picker |
| 2 | P1 | 3-5h | Trace the real source of run status in legacy RunBuilder and document the mapping |
| 3 | P1 | 4-8h | Fix run status / job dispatch status mismatch so the run list status shown to ops is reliable |
| 4 | P2 | 1-2h | Add lightweight logging / comments around the status transition path so future debugging is easier |
| 5 | P2 | ongoing | Append the next screenshot-driven fixes into this spec as Steve sends them |

## Step-by-step checklist

## 1. Default filter date to today

### Current code already found
File:
- `wwwroot/app/components/home/homeControl.js`

Current model bootstrap:
```javascript
$scope.pickDateService = {
    "clients": [],
    "regions": [],
    "ourRefs": [],
    "service": [],
    "status": [],
    "speeds": [],
    "settings": {
        "enableSearch": true,
        "selectedToTop": true,
        "scrollableHeight": '300px',
        "scrollable": true
    },
    "stringSettings": {
        "template": '{{option}}',
        smartButtonTextConverter(skip, option) { return option; },
        "enableSearch": true,
        "selectedToTop": true,
        "scrollableHeight": '300px',
        "scrollable": true
    },
    "date": moment().format("YYYY-MM-DD")
};
```

### What Kevin needs to do

1. Confirm the screen always lands on today's date on first load.
2. Confirm the date shown in the button in `homeView.html` matches the actual filter date used in requests.
3. Confirm the `pickadate` control in `pickDateForm.tpl` does not reopen on a stale prior date.
4. Check whether any downstream refresh path overrides `pickDateService.date` after initialisation.
5. If stale state exists, clear it rather than trying to preserve old filter date silently.

### Files to inspect / edit
- `wwwroot/app/components/home/homeControl.js`
- `wwwroot/app/components/home/homeView.html`
- `wwwroot/app/components/home/tpls/pickDateForm.tpl`

### Acceptance
- Opening the screen defaults to today's date.
- Opening the date popup shows today's date selected unless the operator has explicitly changed it in the current session.
- Clicking refresh does not snap the UI back to an old cached date.

---

## 2. Investigate where run status originates

### Steve's operational concern
From the screenshot annotation:
- the **run list status** (`BUILDING`, `LIVE`) needs to line up with the actual dispatch state of the jobs inside the run
- this needs investigation into **where the run status actually comes from today**

### Current persistence path already identified

#### Run-level status storage
Files:
- `Models/TblBulkRun.cs`
- `Models/UTL_stpJob_tblBulkRunResult.cs`
- `Models/UTL_stpJob_tblBulkRunWithFilterResult.cs`

Relevant field:
- `TblBulkRun.Status`

#### Run save / update path
File:
- `Models/Repository/JobRepository.cs`

Current save path:
```csharp
var runResult = await Context.Procedures.UTL_stpJob_tblBulkRun_InsertOrUpdateAsync(run.ID, run.Name, run.Mins, run.Kms, run.Courier?.courierID,
    run.Status, run.Revenue, run.Payout, courierPercentage, googleRouteResponse, null);
```

Current direct update path:
```csharp
runToUpdate.Status = run.Status;
```

#### Commit/send-live path
File:
- `Models/Repository/JobRepository.cs`

Current send path passes run status into the legacy SP:
```csharp
result.Add(await InsertJobAsync(job.BulkJobID, courierId, runName, runOrder++, courierPercentage, run.Status));
```

And then:
```csharp
await Context.Procedures.UTL_stpJob_InsertFromRunBuilderAsync(jobId, courierId, runName, runOrder, courierPercentage, runStatus);
```

### What Kevin needs to do

1. Trace what numeric values in `tblBulkRun.Status` correspond to visible labels like `BUILDING` and `LIVE`.
2. Confirm whether the UI is rendering a stored run status directly, or whether there is any client-side label mapping layer.
3. Confirm whether dispatching jobs updates:
   - `tblBulkRun.Status`
   - `tblBulkJob.JobStatus`
   - both
   - or only one side
4. Confirm whether `UTL_stpJob_InsertFromRunBuilder` mutates downstream status and whether that mutation is expected to feed back into the run list.
5. Write down the current status truth table before changing anything.

### Minimum output Kevin should produce during implementation
A short mapping table like:

| Stored field | Value | Current UI label | Intended meaning |
|---|---:|---|---|
| `tblBulkRun.Status` | ? | BUILDING | draft / not yet live |
| `tblBulkRun.Status` | ? | LIVE | dispatched / live |
| `tblBulkJob.JobStatus` | ? | D | dispatched |
| `tblBulkJob.JobStatus` | ? | P | picked up |

Without this mapping, the fix is guesswork.

---

## 3. Fix run status vs job dispatch status mismatch

### Intended business rule
The run list status shown to ops must be consistent with the jobs inside that run.

At minimum:
- a run should not show a misleading high-level status if the jobs inside it are already at a different operational state
- dispatch-facing users should be able to trust the status badge / text in the run list

### Practical implementation rule
Kevin should choose one of these models explicitly:

#### Option A — run status is authoritative
- `tblBulkRun.Status` is the source of truth
- dispatch/send-live path must update it correctly every time
- job statuses must remain consistent with it

#### Option B — run status is derived
- run list status is calculated from the jobs inside the run
- the UI derives `BUILDING` / `LIVE` from underlying job dispatch state
- stored run status becomes secondary or display-only

### Recommendation
Prefer **Option A unless the legacy process already behaves as Option B**.

Reason:
- legacy code already persists `run.Status`
- legacy commit path already passes `runStatus` into the SP layer
- that suggests run status was intended to be an explicit state, not just a derived label

### Acceptance
- A run in draft/building state displays as `BUILDING` only when that is truly the operational state.
- A dispatched/live run displays as `LIVE` only when that is truly the operational state.
- The selected jobs inside the run do not visibly contradict the run status in the normal workflow.
- The status does not drift after save, refresh, or send-live.

## Database tables

| Table | Purpose | Columns relevant to this fix |
|---|---|---|
| `tblBulkRun` | Legacy run header | `Id`, `Name`, `Status`, `DespatchDateTime`, `CourierId`, `LastModified` |
| `tblBulkJob` | Legacy builder-side jobs | `BulkJobId`, `BulkRunId`, `JobStatus`, `Void` |
| `tblBulkJobRun` | Run/job join and order | `RunId`, `BulkJobId`, `PickRunOrder` |

### Stored procedures / generated proc wrappers involved

| Procedure | Current usage |
|---|---|
| `UTL_stpJob_tblBulkRun_InsertOrUpdate` | Saves run including `Status` |
| `UTL_stpJob_tblBulkRunWithFilter` | Likely source of run list data including `Status` |
| `UTL_stpJob_InsertFromRunBuilder` | Send-live / commit path takes `RunStatus` |

## Key questions answered

### Can Kevin reuse existing code or is new code required?

Mostly **reuse + correct existing code**.

This is not a blank-slate feature. The relevant status and date handling already exists; the task is to:
- verify it
- document it
- fix drift / mismatch

### What tables does this read from / write to?

Reads from:
- `tblBulkRun`
- `tblBulkJob`
- `tblBulkJobRun`

Writes to:
- `tblBulkRun`
- potentially `tblBulkJob`
- plus downstream live tables indirectly via `UTL_stpJob_InsertFromRunBuilder`

### Are there triggers / side effects to watch for?

Yes.

The main risk is the send-live path:
- `UTL_stpJob_InsertFromRunBuilder` already receives `RunStatus`
- if Kevin changes the meaning or timing of `run.Status` without tracing that SP, he could break dispatch lifecycle behaviour

### What is the most likely current source of run status?

Based on the code already inspected, the most likely current source is:
- `tblBulkRun.Status`
- surfaced through `UTL_stpJob_tblBulkRunWithFilter`
- persisted through `UTL_stpJob_tblBulkRun_InsertOrUpdate`
- reused in send-live through `UTL_stpJob_InsertFromRunBuilder`

That needs confirming, but it is the right first assumption.

## API endpoints summary

| Method | Route | Purpose | Tables read | Tables written |
|---|---|---|---|---|
| GET | `/Job/GetBulkRuns?datetime=...` | Load run list for selected date | `tblBulkRun`, likely join/read around `tblBulkJobRun` | — |
| GET | `/Job?...` | Load jobs for selected date/filter | `tblBulkJob` | — |
| POST | run save/update path | Save edited run state | `tblBulkRun` | `tblBulkRun` |
| POST | send-to-live path | Commit run/jobs to live flow | `tblBulkRun`, `tblBulkJob` | downstream live path via `UTL_stpJob_InsertFromRunBuilder` |

## Frontend components

```text
wwwroot/app/components/home/
├── homeControl.js
├── homeView.html
└── tpls/
    └── pickDateForm.tpl
```

### Relevant behaviours

- `homeControl.js`
  - initialises `pickDateService.date`
  - drives `getData(1)` refresh flow
  - loads runs and jobs for chosen date
- `homeView.html`
  - shows the date button the operator clicks
- `pickDateForm.tpl`
  - contains the date picker popup

## Testing checklist

### Staging first

1. Open the legacy screen fresh.
2. Confirm date defaults to today.
3. Open the date popup and confirm the picker reflects today.
4. Refresh the screen and confirm the date remains correct.
5. Load a run known to be `BUILDING`.
6. Load a run known to be `LIVE`.
7. Compare the run list status with the jobs inside each run.
8. Save a run and refresh.
9. Send a run live and refresh.
10. Confirm the run status still matches the actual operational state.

### Production caution

- Do not change run-status semantics without tracing `UTL_stpJob_InsertFromRunBuilder` first.
- If the SP is the real status transition source, fix the source rather than papering over it only in the UI.

## Notes

This is the **first screenshot-derived batch only**.
Add the next narrated screenshots into this same doc as additional numbered fix items.
