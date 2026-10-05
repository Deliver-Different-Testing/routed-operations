---
title: Kevin — Driver Scheduling into Routed Operations
date: 2026-08-27
audience: Kevin
status: Active handover brief
current_workspace_path: /data/.openclaw/workspace/routed-operations
target_repo_name: routed-operations
source_reassigned_from: https://github.com/Deliver-Different-Testing/dfrntdrive_configurator/blob/master/docs/STEVE-SCHEDULING-DRIVER-GARRY-2026-07-27.md
reference_ui:
  - https://dfrntdriveconfig.otgcargo.staging.deliverdifferent.com/scheduling
related_docs:
  - HANDOVER-KEVIN-ROUTED-OPERATIONS-2026-06-23.md
  - KEVIN-SCHEDULES-ZONES-ZONE-GROUPS-HANDOVER-2026-08-21.md
---

# Kevin — Driver Scheduling into Routed Operations

## Decision
This is no longer a Garry/dashboard item.

It should move to **Kevin** under **Routed Operations**.

The product instruction is:

> bring **Driver Scheduling** into Routed Operations using the newer Configurator framework/screen shape already established at `/scheduling`, while still treating the real functional source as a **lift-and-shift + modernise** from the old Courier Manager scheduler.

So this is **not** a greenfield scheduler design.
It is also **not** “leave the prototype where it is and just wire a couple of endpoints”.

It is a Kevin-owned migration into Routed Operations.

---

## Executive call

### What Kevin should reuse
Kevin should reuse **two different things for two different reasons**:

1. **Courier Manager** for the real scheduling behaviour and operational rules
2. **Configurator scheduling framework** for the modern delivery shell / screen structure / interaction pattern

### What Kevin should not do
- do **not** rebuild the scheduler concept from scratch
- do **not** copy the old Angular Courier Manager UI as-is
- do **not** leave this stranded as a Configurator-only prototype lane
- do **not** treat the current `/scheduling` page as production-ready truth just because the shell exists

### Short version
**Lift the real old scheduler into Routed Operations, but land it in the newer Configurator-style framework rather than in the old Courier Manager UI shape.**

---

## Product framing
This should sit inside the Routed Operations umbrella beside the other operational planning surfaces.

Recommended framing:

- **Routed Operations** = umbrella app/repo
- **Driver Scheduling** = courier/driver scheduling module inside Routed Operations
- **Route Builder** = separate but adjacent planning module
- **Legacy Courier Manager** = old behaviour source of truth
- **Configurator scheduling** = modern shell/pattern to lift from

This work is still part of the broader “modernise operations without throwing away real dispatch behaviour” path.

---

## Source systems Kevin must use

## 1. Legacy functional source of truth — old Courier Manager
These are the real behaviour references from the earlier Garry brief and should still be treated as the operational source of truth:

- `couriermanager/API/Controllers/SchedulesController.cs`
- `couriermanager/Core/Application/Services/ScheduleService.cs`
- `couriermanager/Core/Application/Utilities/ScheduleUtility.cs`
- `couriermanager/wwwroot/app/services/schedulerService.js`
- `couriermanager/wwwroot/app/components/scheduler/schedulerControl.js`

Core behaviour to preserve:
- schedule summaries by date and location
- schedule create / update / delete
- time-slot create / update / delete
- courier availability and cancellation flow
- time-slot assignment
- reminder / notification sending
- schedule copy
- courier filtering by region / vehicle / location fit
- schedule conflict checks
- started / ended state rules

## 2. Modern framework/screen source — Configurator scheduling
Use the existing Configurator scheduling lane as the **delivery framework reference**, not as proof the job is done.

Relevant workspace files:

- `dfrnt-agents-partners/web-unified/src/pages/np/Scheduling.tsx`
- `dfrnt-agents-partners/web-unified/src/services/np_schedulingMockData.ts`
- `dfrnt-agents-partners/api/src/DfrntAgentsPartners.Api/Controllers/SchedulingController.cs`
- `dfrnt-agents-partners/api/src/DfrntAgentsPartners.Infrastructure/Services/SchedulingService.cs`
- `dfrnt-agents-partners/api/src/DfrntAgentsPartners.Infrastructure/Migrations/014_SchedulingTables.sql`

What this proves:
- there is already a modern scheduling screen shape worth reusing
- there is already an API/controller/service scaffold worth mining
- the current frontend is still largely mock/demo-driven
- the current backend service is much thinner than the real legacy scheduler

So Kevin should lift the **shell/pattern**, but replace the dummy/thin guts with the real migrated behaviour.

---

## Current-state verdict

## Courier Manager
Courier Manager still contains the real operational scheduling behaviour.

## Configurator `/scheduling`
The Configurator `/scheduling` lane already gives Kevin a useful modern framework, but it is not the full real scheduler yet.

From the current workspace review:
- the screen is driven by `np_schedulingMockData.ts`
- the page already has a good modern interaction pattern: date, locations, schedule cards, courier tabs, copy/notify flows, modal-driven actions
- the current API/service scaffold supports only a cut-down scheduling model
- it does **not** yet represent full legacy parity

That makes the right instruction:

> **reuse the Configurator framework, but migrate the real Courier Manager scheduler behaviour into Routed Operations behind it**

---

## Routed Operations target

Put the finished module in:
- repo: `routed-operations`
- docs: `routed-operations/docs/`
- UI/application lane: Routed Operations app/module structure

This should become the Kevin-owned operational scheduling module rather than lingering as a side lane in Garry’s configurator dashboard queue.

---

## Build approach

## Phase 1 — lift the modern screen framework
Use the existing Configurator scheduling page as the UI/UX starting point:

- header/date/location structure
- schedule card layout
- schedule detail + courier-response split
- copy flow
- notify flow
- time-slot modal pattern
- assignment modal pattern

Kevin should reuse/adapt that shell into Routed Operations rather than rebuilding a third scheduling UI.

## Phase 2 — replace the fake/thin internals with real legacy behaviour
Bring over the real scheduling logic from Courier Manager:

- proper schedule lifecycle rules
- time-slot validation
- courier availability state rules
- conflict detection
- reminder/send logic via a modernised abstraction
- schedule copy semantics
- real region/location/vehicle compatibility rules

## Phase 3 — modernise the unsafe legacy edges
Do **not** port these blindly:

- AngularJS UI/controller code
- NZ-only phone assumptions
- hardcoded portal URLs
- brittle string-based vehicle matching where IDs/codes are available
- hidden DB-trigger dependencies without first surfacing what they do

## Phase 4 — align with Routed Operations architecture
The finished result should look like a native Routed Operations module, not a pasted Configurator page and not an Angular transplant.

---

## Reuse vs rewrite

## Reuse directly / preserve behaviour
From Courier Manager, preserve:
- schedule conflict logic
- schedule started / ended checks
- time-slot-inside-window validation
- availability / cancellation state rules
- response assignment rules
- schedule summary rollup behaviour
- copy-schedule behaviour
- tenant/local time conversion approach

From Configurator, preserve:
- modern page composition
- modal structure
- tab/selection flow
- schedule-card presentation model
- operator interaction pattern for copy/notify/assign

## Rewrite / modernise
Rewrite:
- the Angular scheduler UI/service layer
- old notification plumbing if it is hardwired to NZ-specific/manual-message assumptions
- any hidden trigger-dependent behaviour that should live in app code
- brittle name/string matching logic where stable IDs should be used
- any repo-local dummy mock-data pattern once real APIs are in place

---

## Practical implementation targets

## Legacy behaviour references
- `couriermanager/API/Controllers/SchedulesController.cs`
- `couriermanager/Core/Application/Services/ScheduleService.cs`
- `couriermanager/Core/Application/Utilities/ScheduleUtility.cs`
- `couriermanager/wwwroot/app/services/schedulerService.js`
- `couriermanager/wwwroot/app/components/scheduler/schedulerControl.js`

## Modern shell references
- `dfrnt-agents-partners/web-unified/src/pages/np/Scheduling.tsx`
- `dfrnt-agents-partners/web-unified/src/services/np_schedulingMockData.ts`
- `dfrnt-agents-partners/api/src/DfrntAgentsPartners.Api/Controllers/SchedulingController.cs`
- `dfrnt-agents-partners/api/src/DfrntAgentsPartners.Infrastructure/Services/SchedulingService.cs`
- `dfrnt-agents-partners/api/src/DfrntAgentsPartners.Infrastructure/Migrations/014_SchedulingTables.sql`

## Routed Operations landing zone
Kevin should implement the migrated module in the Routed Operations repo using its normal app structure, not by leaving the real work back in Configurator.

---

## Required investigation before Kevin codes deeply

1. **Confirm the exact legacy DB/side-effect surface**
   - schedule tables
   - response tables/status rows
   - any schedule-related triggers
   - notification side effects

2. **Compare legacy scheduler capability against current Configurator scaffold**
   - what exists only as mock UI today
   - what exists only as thin CRUD today
   - what real parity rules are still missing

3. **Define the comms path for reminders/notifications**
   - keep legacy queue only if still platform standard
   - otherwise put scheduling comms behind a cleaner service boundary

4. **Validate country/tenant assumptions**
   - no NZ-only phone/url logic
   - location/region semantics still fit OTG/US tenants
   - vehicle typing uses stable references where possible

---

## Acceptance criteria

- **AR-1** Driver Scheduling is treated as a Kevin / Routed Operations workstream, not a Garry dashboard item.
- **AR-2** Routed Operations gets a real Driver Scheduling module using the modern Configurator scheduling framework as the UI pattern.
- **AR-3** Real scheduling behaviour comes from lift-and-shift + modernise of the old Courier Manager scheduler, not from inventing new rules.
- **AR-4** Mock/demo scheduling data is removed from the delivered Routed Operations module.
- **AR-5** Schedule create/edit/delete, slot management, availability states, copy flow, assignment flow, and reminder flow all operate against real backend logic.
- **AR-6** NZ-specific legacy assumptions are removed or isolated behind proper abstractions.
- **AR-7** The result fits the Routed Operations architecture and UI rather than looking like an Angular transplant.

---

## Bottom line

This work should be reframed as:

> **Kevin to bring Driver Scheduling into Routed Operations by lifting the real old Courier Manager scheduler and modernising it into the Configurator-style framework already established at `/scheduling`.**

That is the correct ownership and the correct technical approach.