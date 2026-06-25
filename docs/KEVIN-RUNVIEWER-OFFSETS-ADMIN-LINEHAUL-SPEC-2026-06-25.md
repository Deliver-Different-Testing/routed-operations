---
title: Kevin RunViewer offsets, Admin Manager config, and linehaul detail tweaks spec
created: 2026-06-25
status: New follow-on spec after legacy fixes batch
source: Steve direction + screenshot review
related_docs:
  - KEVIN-LEGACY-RUNBUILDER-FIXES-SPEC-2026-06-23.md
  - STEVE-KEVIN-FIRST-UP-FIXES-RUNVIEWER-RECURRING-2026-06-20.md
---

# Kevin RunViewer offsets, Admin Manager config, and linehaul detail tweaks spec

## Feature overview

This is a **new** follow-on spec.
Do not append this work into `KEVIN-LEGACY-RUNBUILDER-FIXES-SPEC-2026-06-23.md` because Steve has confirmed that earlier spec is already complete.

This batch covers four linked areas:

1. **Persist pickup / delivery early-late offset values on the operational job lifecycle tables** so breach reporting is historically stable.
2. **Add Admin Manager edit capability** for service/speed offset minutes using the existing service maintenance screen.
3. **Preserve the user-selected recurring booking ready time** into `tucJobBooking` and `tucJob` instead of collapsing back to the schedule start time.
4. **Tidy the linehaul dash run detail grid** so delivery location is not visually duplicated.

---

## Steve decisions already made

These are not open questions anymore:

- Store the resolved values on **all 4 operational tables**:
  - `tucJobBooking`
  - `tblBulkJob`
  - `tucJob`
  - `tucJobArchive`
- Update the **archive process** if required so the values carry through unchanged.
- Admin users must be able to maintain the service/speed offset minutes in **Admin Manager** first.
- RouteViewer already shows at least the **pickup window** in job detail, so this is not a blank-slate display feature.
- In recurring booking creation, the **user-selected ready time is authoritative** and must persist into `tucJobBooking` and `tucJob`; do not replace it with the recurring schedule start time.

---

## Why this must be persisted

Steve clarified that **breaches of the early/late offset window are a tenant reporting metric**.

That means compute-on-read alone is not acceptable as the reporting source of truth.
If the offsets live only on `tucJobType` / `tblClientJobType` and are recalculated later, historical results drift when settings change.

### Required rule

When a job becomes operational, the system must stamp the **resolved offset values that applied at that time** onto the job lifecycle tables.
Those stamped values must remain the basis for later reporting and archived history.

---

## 1. Persisted offset and window model

## Required columns

Add resolved minute offset fields to all 4 operational tables:

- `PickupEarlyOffsetMins`
- `PickupLateOffsetMins`
- `DeliveryEarlyOffsetMins`
- `DeliveryLateOffsetMins`

Strong recommendation: also stamp the resolved window datetimes on the same rows:

- `PickupWindowStart`
- `PickupWindowEnd`
- `DeliveryWindowStart`
- `DeliveryWindowEnd`

### Why store both mins and datetimes

Store the **minutes** because they preserve the contractual/config basis.
Store the **resolved datetimes** because they make reporting, filtering, and breach calculations far simpler.

### Resolution order

For each job record, resolve in this order:

1. `tblClientJobType` override
2. `tucJobType` service default
3. zero/fallback only if nothing configured

Once stamped to the operational job record, do **not** re-resolve historical jobs from current lookup data.

---

## 2. Scope of data changes

### Tables in scope

| Table | Requirement |
|---|---|
| `tucJobBooking` | stamp values when job is initially created/booked |
| `tblBulkJob` | carry same values through legacy RunBuilder / linehaul staging flow |
| `tucJob` | live operational source for reporting and UI |
| `tucJobArchive` | retain historical values unchanged |

### Archive flow

Kevin must trace the archive path and update any affected:

- archive stored procedures
- insert-select archive moves
- copy jobs / promotion paths
- EF models / generated wrappers if used

### Acceptance

- A service offset change tomorrow does not alter last week's breach reporting.
- Archived jobs return the same breach basis as live jobs did before archive.
- SQL/reporting can read the job row directly without recomputing from current config.

---

## 3. Admin Manager service/speed editing

## Goal

Expose the offset-minute configuration in the **existing Admin Manager service/speed maintenance screen**.
Steve's screenshot shows the correct edit surface.

### Existing context from screenshot

The existing form already includes service metadata such as:

- Name
- Short Name
- Description
- Code
- Job Letter
- Minutes
- Pickup/Delivery Time
- Rating Method
- other service configuration fields

So this work should be an **extension of the current screen**, not a new config module.

### Required new editable fields

On the service/speed editor, add:

- Pickup early offset mins
- Pickup late offset mins
- Delivery early offset mins
- Delivery late offset mins

These should write to `tucJobType` as the service-level defaults.

### Optional follow-on

If the client override layer is already editable elsewhere, mirror compatible fields for `tblClientJobType`.
But the first mandatory delivery is the Admin Manager service/speed screen.

### Validation rules

- integer minutes only
- allow `0`
- allow `NULL` only where inheritance behaviour explicitly requires it
- labels must be unambiguous about early vs late and pickup vs delivery

### Behaviour rule

Updating a service changes the defaults for **newly created jobs only**.
It must not retroactively change stamped values on existing jobs.

---

## 4. RouteViewer / RunViewer read-side implications

## Current state

RouteViewer already appears to expose pickup window data in job detail.
So Kevin does not need to invent the display model from nothing.

### What Kevin needs to confirm

1. Which screens already use persisted or derived pickup/delivery window values.
2. Whether delivery-side window exposure matches pickup-side exposure.
3. Whether breach state needs a clearer visual treatment.
4. Whether current display is still recomputing from live config instead of using stamped job values.

### Rule

Display helpers may format friendly strings, but reporting and operational breach logic must come from the persisted job values.

---

## 5. Preserve user-selected recurring ready time

## Steve test evidence

Steve's test case shows a concrete mismatch:

- booking was created with **16:00** ready time
- recurring list later showed **15:45**
- RouteViewer later showed **15:45**
- **15:45 is the recurring schedule start time, not the user-selected booking ready time**

So somewhere in the recurring booking creation path, the chosen booking time is being replaced by the schedule start time.

## Required rule

For recurring booking creation, the **user-selected ready time** must persist into the created operational records.
The recurring schedule start time may still be used for schedule grouping / recurrence logic, but it must not overwrite the chosen booking ready time.

## Minimum persistence requirement

At minimum, preserve the chosen ready time into:

- `tucJobBooking`
- `tucJob`

If the system uses an intermediate recurring/prebook row before those tables, Kevin must trace and fix the overwrite there too.

## Likely source to inspect

Steve's suspicion is probably right: this is likely in the recurring booking SP path.
Inspect:

- recurring booking stored procedure(s)
- recurring-job promotion stored procedure(s)
- any `tucJobPrebook` / recurring-source mapping if involved
- any API/UI payload mapping where both schedule start and ready time are present

## Acceptance

- A booking created with **16:00** stores **16:00** in `tucJobBooking`.
- The resulting job stores **16:00** in `tucJob`.
- RouteViewer shows **16:00** for the job unless deliberately rendering a separate schedule field.
- The recurring list shows the chosen booking ready time, not the schedule start time.
- Schedule grouping can still use the schedule start as a separate concept.

---

## 6. Linehaul dash run detail tweak

## Steve screenshot instruction

Steve's screenshot shows that the **originating pickup point is now correct**, but the **delivery location is doubled up** in the linehaul dash run detail.
He only wants the **abbreviated right-hand detail** retained.

### Likely current implementation

In the current linehaul job list/grid, the delivery-side columns are split across:

- full delivery address column
- abbreviated destination suburb/city column

Relevant current file:
- `gitlab-source/runviewer/wwwroot/app/components/linehaul/tpls/jobList.tpl`

Current rows include both:

- `{{job.toAddress}}`
- `{{ isNZTenant ? job.toSuburb : (job.toCity || job.toSuburb) }}`

That matches Steve's note that the delivery location is visually duplicated.

### Required change

In the **linehaul dash run detail grid**, remove the redundant delivery-location duplication and keep only the abbreviated right-hand destination detail.

### Intent

- keep the originating pickup point fix intact
- keep the abbreviated destination identifier
- remove the duplicate long-form delivery rendering where it adds no value

### File to inspect first

- `wwwroot/app/components/linehaul/tpls/jobList.tpl`
- plus any matching header definitions in `wwwroot/app/components/linehaul/linehaulControl.js`

### Acceptance

- linehaul grid still shows the originating pickup point correctly
- destination no longer appears doubled up
- the right-hand abbreviated destination detail remains visible
- headers still align with actual rendered values

---

## 7. Recommended implementation order

1. Add DB columns and update models/wrappers
2. Stamp resolved values into `tucJobBooking`
3. propagate through `tblBulkJob`
4. stamp/preserve in `tucJob`
5. copy unchanged into `tucJobArchive`
6. add Admin Manager editing for service defaults
7. fix recurring booking creation so chosen ready time survives into `tucJobBooking` and `tucJob`
8. update RouteViewer read paths to prefer stamped values
9. apply linehaul grid duplication fix

---

## Key questions answered

### Should this remain compute-on-read only?

No.
Not once early/late breaches are a tenant reporting metric.

### Is adding fields to live + archive fundamental?

Yes.
This is a fundamental schema and lifecycle change.
But it is justified because the reporting requirement makes the resolved window part of the operational record.

### Should existing finished spec be edited?

No.
This follow-on work belongs in this new spec.

---

## Testing checklist

1. Update a service/speed offset in Admin Manager.
2. Create a new job and confirm the resolved values are stamped.
3. Confirm an older job keeps its original stamped values.
4. Push a job through booking -> bulk/run -> live -> archive and confirm values survive unchanged.
5. Verify RouteViewer job detail still shows pickup window correctly.
6. Verify any delivery-side window/breach display reads stamped values.
7. Create a recurring booking with a ready time different from the schedule start time and confirm the chosen ready time survives into `tucJobBooking` and `tucJob`.
8. Verify RouteViewer and the recurring list show the chosen ready time rather than the schedule start time.
9. Verify linehaul grid no longer duplicates delivery location.
10. Verify the abbreviated right-hand destination detail remains.
