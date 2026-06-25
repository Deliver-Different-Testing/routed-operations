---
title: Kevin handover — RunViewer offsets, Admin Manager config, and linehaul detail tweak
date: 2026-06-25
audience: Kevin / Steve
status: Active handover brief
current_workspace_path: /data/.openclaw/workspace/routed-operations
target_repo_name: routed-operations
related_docs:
  - KEVIN-RUNVIEWER-OFFSETS-ADMIN-LINEHAUL-SPEC-2026-06-25.md
  - KEVIN-LEGACY-RUNBUILDER-FIXES-SPEC-2026-06-23.md
  - HANDOVER-KEVIN-ROUTED-OPERATIONS-2026-06-23.md
---

# Kevin handover — RunViewer offsets, Admin Manager config, and linehaul detail tweak

## Claude Code steps

```bash
cd /data/.openclaw/workspace/routed-operations
ls -la docs/HANDOVER-KEVIN-RUNVIEWER-OFFSETS-ADMIN-LINEHAUL-2026-06-25.md
ls -la docs/KEVIN-RUNVIEWER-OFFSETS-ADMIN-LINEHAUL-SPEC-2026-06-25.md
ls -la Models/TucJobType.cs
ls -la Models/TucJob.cs
ls -la Models/TblBulkJob.cs
ls -la wwwroot/app/components/linehaul/tpls/jobList.tpl
```

## Feature overview

This is a **new Kevin handover item** after the legacy RunBuilder fixes batch.
Do **not** append this into `KEVIN-LEGACY-RUNBUILDER-FIXES-SPEC-2026-06-23.md` because Steve confirmed that earlier work is finished.

This handover covers four linked pieces:

1. **Persist early/late pickup and delivery offsets on the operational job lifecycle tables** so breach reporting is historically correct.
2. **Add Admin Manager editing for service/speed offset minutes** on the existing service maintenance screen.
3. **Preserve the user-selected recurring booking ready time** into `tucJobBooking` and `tucJob` instead of collapsing back to the schedule start time.
4. **Tweak the linehaul dash run-detail grid** so the delivery location is not doubled up.

## Steve decisions already made

These points are already decided:

- Store the resolved values on **all 4 operational tables**:
  - `tucJobBooking`
  - `tblBulkJob`
  - `tucJob`
  - `tucJobArchive`
- Update the **archive process** if necessary so the values carry through unchanged.
- The first required edit surface is **Admin Manager** on the existing service/speed screen.
- RouteViewer already shows the **pickup window** in job detail, so this is not a blank-slate display job.
- In the **linehaul dash run detail grid**, keep the abbreviated right-hand destination detail and remove the redundant duplicate delivery location.
- In recurring booking creation, the **user-selected ready time is authoritative** and must persist into `tucJobBooking` and `tucJob`; do not replace it with the recurring schedule start time.

## Why persistence is required

Steve clarified that **breaches of the early/late offset window are a tenant-facing reporting metric**.
That changes this from display logic into persisted operational data.

If the system only derives windows from current `tucJobType` / `tblClientJobType` settings at read time, historical reporting will drift whenever service settings change later.

### Required rule

When a job becomes operational, stamp the **resolved offset values that applied at that moment** onto the job lifecycle records.
Historical reporting and archived jobs must use those stamped values, not re-resolve from current configuration.

## What Kevin needs to do

| # | Priority | Est. | Task |
|---|---|---:|---|
| 1 | P1 | 4-8h | Add resolved pickup/delivery offset-minute columns to the 4 operational tables |
| 2 | P1 | 4-8h | Strongly recommended: also stamp resolved pickup/delivery window start/end datetimes on those same tables |
| 3 | P1 | 4-6h | Update job creation/promotion paths so resolved values are stamped once and preserved |
| 4 | P1 | 2-4h | Update archive flow so the values move unchanged into `tucJobArchive` |
| 5 | P1 | 3-5h | Add Admin Manager service/speed editing for the 4 offset-minute defaults on `tucJobType` |
| 6 | P1 | 2-4h | Fix recurring booking creation so the user-selected ready time persists into `tucJobBooking` and `tucJob` instead of falling back to the schedule start time |
| 7 | P2 | 2-4h | Confirm RouteViewer reads persisted values rather than recomputing from current config wherever breach/window logic matters |
| 8 | P2 | 1-2h | Remove duplicated delivery-location rendering in the linehaul dash run-detail grid |

## Step-by-step checklist

### 1. Add persisted fields to the 4 operational job tables

Add resolved offset-minute columns to:

- `tucJobBooking`
- `tblBulkJob`
- `tucJob`
- `tucJobArchive`

Required columns:

- `PickupEarlyOffsetMins`
- `PickupLateOffsetMins`
- `DeliveryEarlyOffsetMins`
- `DeliveryLateOffsetMins`

Strong recommendation: also add resolved datetimes:

- `PickupWindowStart`
- `PickupWindowEnd`
- `DeliveryWindowStart`
- `DeliveryWindowEnd`

### 2. Resolve values once, then stamp them

Resolution order per job:

1. `tblClientJobType` override
2. `tucJobType` service default
3. zero/fallback only if nothing is configured

Once a job row is created/promoted, **do not** later recompute the historical values from current lookup data.

### 3. Update the lifecycle paths

Kevin must trace the actual insert/promotion flow so the stamped values follow the job through:

- booking/pre-operational stage
- bulk/legacy working stage
- live operational job row
- archive

Any copy/promotion path that creates or transforms a job row must preserve the resolved values.

### 4. Update archive flow

Trace and update any relevant:

- archive stored procedures
- insert-select archive moves
- copy jobs / promotion paths
- EF models / generated wrappers if used in this repo

Acceptance rule:

- archived jobs must carry the same stamped values they had while live

### 5. Add Admin Manager editing on the existing service/speed screen

Steve’s screenshot shows the correct edit surface.
Do not create a separate config module first.

Add editable fields to the existing service/speed maintenance screen for:

- Pickup early offset mins
- Pickup late offset mins
- Delivery early offset mins
- Delivery late offset mins

These fields should write to service defaults on `tucJobType`.

Validation:

- integer minutes only
- allow `0`
- allow `NULL` only if the inheritance rule requires it
- labels must clearly distinguish pickup vs delivery and early vs late

Important rule:

- changing a service default affects **new jobs only**
- existing jobs keep their stamped values

### 6. Preserve user-selected recurring ready time

Steve's test case is explicit:

- user chose **16:00** as the ready time during recurring booking creation
- recurring list later showed **15:45**
- RouteViewer later showed **15:45**
- **15:45 is the recurring schedule start time, not the user-selected ready time**

That means the recurring booking path is currently collapsing the user-entered booking time back to the schedule time somewhere before or during persistence.

### Required rule

For recurring booking creation, the **user-selected ready time is the source of truth** for the created booking/job record.

The recurring schedule start time may still be used for schedule grouping or recurrence generation rules, but it must **not overwrite** the chosen booking ready time on the created operational records.

### Tables that must preserve the chosen ready time

At minimum:

- `tucJobBooking`
- `tucJob`

If an intermediate recurring/prebook path exists, Kevin must trace that too and stop the overwrite there.

### Likely source to inspect

Steve's suspicion is probably right: this is likely in the **recurring booking stored procedure path** where the created booking inherits the schedule start time instead of the selected booking ready time.

Kevin should trace:

- recurring booking insert SP(s)
- any recurring-job promotion SP(s)
- any `tucJobPrebook` / recurring source row mapping if used
- any UI/API payload mapping that passes both schedule time and ready time

### Acceptance

- If the user selects **16:00**, the created recurring booking stores **16:00** in `tucJobBooking`.
- The created live/operational job stores **16:00** in `tucJob`.
- RouteViewer shows **16:00** for the created recurring job unless deliberately displaying a separate schedule field.
- The recurring list does not silently replace the chosen booking time with the schedule start time.
- Schedule grouping logic can still use the schedule start separately if needed, but that must be a separate concern from the booking ready time.

### 7. RouteViewer read-side rule

RouteViewer can still format friendly display strings, but the operational/reporting basis must come from the persisted job values, not from recalculating off current config.

Kevin should verify:

- which screens already show pickup window / delivery window
- whether delivery-side exposure matches pickup-side exposure
- whether breach logic is using stamped values or live config

### 8. Linehaul dash run-detail tweak

Steve’s screenshot shows:

- the **originating pickup point is now correct**
- the **delivery location is doubled up**
- only the **abbreviated right-hand destination detail** should remain

Likely current source:

- `wwwroot/app/components/linehaul/tpls/jobList.tpl`
- matching header definitions in `wwwroot/app/components/linehaul/linehaulControl.js`

Current grid likely shows both:

- full destination address (`job.toAddress`)
- abbreviated destination suburb/city (`job.toSuburb` / `job.toCity`)

Required change:

- keep the pickup-point fix
- keep the abbreviated right-hand destination field
- remove the redundant duplicate destination rendering

## Database tables

| Table | Purpose | What changes |
|---|---|---|
| `tucJobBooking` | booking/pre-live job row | add resolved offset mins + strongly recommended window datetimes |
| `tblBulkJob` | legacy working/builder-side row | add resolved offset mins + strongly recommended window datetimes |
| `tucJob` | live operational row | add resolved offset mins + strongly recommended window datetimes |
| `tucJobArchive` | historical/archive row | add resolved offset mins + strongly recommended window datetimes |
| `tucJobType` | service/speed defaults | add editable default offset-minute fields |
| `tblClientJobType` | client/service override layer | use as first-priority override source where available |

## Key questions answered

### Should this stay compute-on-read only?

No.
Not if early/late breaches are a reporting metric for tenant clients.

### Is adding these fields through live + archive fundamental?

Yes.
This is a fundamental schema/lifecycle change.
But it is justified because the promised-window basis now forms part of the operational record.

### Should Kevin store only the minute offsets, or also the resolved window datetimes?

Store **both**.

- minutes preserve the contract/config basis
- window datetimes make SQL, filtering, and breach reporting much simpler

### Does this replace the finished legacy fixes spec?

No.
This is a new follow-on handover item.

## Frontend / file touchpoints

### Likely RouteViewer / linehaul files

- `wwwroot/app/components/linehaul/tpls/jobList.tpl`
- `wwwroot/app/components/linehaul/linehaulControl.js`
- any RouteViewer job-detail templates currently showing pickup/delivery windows

### Likely model / persistence files

- `Models/TucJobType.cs`
- `Models/TucJob.cs`
- `Models/TblBulkJob.cs`
- booking/archive models and any generated proc wrappers used by this repo

## Testing checklist

1. Update a service/speed offset in Admin Manager.
2. Create a new job and confirm the resolved values are stamped.
3. Confirm an older job keeps its original stamped values.
4. Push a job through booking -> bulk/working -> live -> archive and confirm values survive unchanged.
5. Verify RouteViewer job detail still shows pickup window correctly.
6. Verify delivery-side window/breach logic reads stamped values.
7. Create a recurring booking with a ready time different from the schedule start time and confirm the chosen ready time survives into `tucJobBooking` and `tucJob`.
8. Verify RouteViewer and the recurring list show the chosen ready time rather than the schedule start time.
9. Verify linehaul grid no longer duplicates delivery location.
10. Verify the abbreviated right-hand destination detail remains visible.
