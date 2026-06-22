---
title: RouteBuilder dynamic mode plan
date: 2026-06-22
audience: Steve / Kevin
status: Working implementation direction
related_docs:
  - RUNBUILDER-REBUILD-TO-ROUTEBUILDER-CONSOLIDATED-2026-06-20.md
  - STEVE-ROUTEBUILDER-V2-PARITY-LIFT-PLAN-KEVIN-2026-06-20.md
---

# RouteBuilder dynamic mode plan

## 1. Summary

RouteBuilder must support **two planning modes**:

1. **Batch / prebuild mode**
   - preserves the current RunBuilder use case
   - works from a known dataset ahead of service day
   - continues to use the existing bulk/run-builder flow during parity delivery

2. **Dynamic / rolling mode**
   - handles delivery data that accumulates over time from multiple sources
   - supports progressive route formation during the day
   - should operate directly on **`tucJob`** rather than relying on `tblBulkJob` promotion

This document covers the **dynamic mode** specifically.

---

## 2. Core decision

### Dynamic mode should live in `tucJob`

For dynamic mode, new jobs should be created directly in **`tucJob`**.

### Why

- avoids a separate bulk-to-live insert step
- makes individually booked jobs and dynamically routed jobs part of the same operational pool
- makes merging booked jobs into routes much easier
- removes duplicated state between `tblBulkJob` and `tucJob`
- better fits rolling dispatch than the old bulk staging model

### Consequence

Dynamic mode should **not** be built around `tblBulkJob` as its primary working set.

`tblBulkJob` remains useful for the existing **batch/prebuild** mode during parity and transition.

---

## 3. Status model

### Step 1

Insert dynamic deliveries into `tucJob` with a new status:

- **`ToRoute`** (working name)

This means:
- the job exists in the live operational job table immediately
- it is not yet fully routed/assigned
- it is available to the RouteBuilder dynamic planner

### Why not add a second routing-status field?

Because existing automations already key off job status.

Adding a second separate routing/planning status would likely mean:
- rebuilding automations
- duplicating lifecycle logic
- sync risk between two state models
- more edge cases across dispatch/reporting/integration flows

### Current recommendation

Use the existing job lifecycle model in `tucJob` and extend it with a new real status:

- `ToRoute`

Rather than introducing:
- a separate routing status column, or
- a separate routing state sidecar table as the primary lifecycle driver

### Caution

Before shipping `ToRoute`, audit every automation and downstream process that currently keys off `ucjbStatus`, especially:

- dispatch visibility
- mobile/courier assignment flows
- reporting
- billing/export assumptions
- notifications
- completion / POD logic

The goal is to extend the current lifecycle cleanly, not create a status that is accidentally treated as dispatched, billable, or courier-visible too early.

---

## 4. Dynamic mode problem definition

The old RunBuilder was built for:
- large known datasets
- advance planning
- depot-led route creation
- mostly static runs before dispatch

Dynamic mode must instead support:
- jobs arriving progressively
- multiple inbound sources
- incomplete data early in the day
- selective re-planning
- merging individually booked jobs into draft runs
- operator-assisted routing decisions

This is not just a different UI.
It is a different **planning strategy**.

---

## 5. What dynamic mode needs to decide

For each `tucJob` in `ToRoute`, the planner should determine whether to:

1. **hold** the job for more density / more incoming work
2. **append** it to an existing draft route
3. **create** a new draft route
4. **re-optimise** an existing draft route
5. **leave it manual** because constraints or confidence are poor

A major part of this decision is whether adding the job would push the route beyond:
- its max route time
- its permitted dispatch window
- its safe completion threshold

This planner logic should live in the **application layer**, not in the legacy SPs.

---

## 6. New constraints the planner must support

Dynamic mode must treat these as first-class routing constraints:

- fixed times
- target delivery times / delivery windows
- **maximum route time / route window**
- furthest destination logic
- round trip required
- fixed final destination

### Maximum route time / route window

This is a key build parameter for prospective tenants.

Example:
- route window: **9:00 AM to 12:00 PM**
- maximum route time: **3 hours**

The planner should pack as many deliveries into that route as possible **without exceeding the safe end of the window**.

This means dynamic mode must consider not just stop count or shortest distance, but whether the total projected route can still:
- start within the allowed window
- complete within the max route duration
- finish before the route end time
- maintain enough buffer that the route is still operationally safe, not mathematically perfect only on paper

This should be treated as a hard or near-hard planning constraint depending on tenant configuration.

These constraints are the main reason dynamic mode should not be forced through the old postcode-group planning assumptions.

---

## 7. Shared model vs different planning strategies

### Shared domain

Both batch and dynamic modes should share the same broad operational model:

- jobs
- runs/routes
- couriers
- depots
- route metrics
- assignment
- lock/freeze behaviour
- dispatch lifecycle

### Different strategy

But they should use different planning strategies:

- **Batch strategy** = build from a known filtered working set
- **Dynamic strategy** = continuously assess and update draft routes as jobs arrive

RouteBuilder should therefore be structured around an explicit planning-mode concept, e.g.:

- `Batch`
- `Dynamic`

---

## 8. Dynamic mode working states

Suggested status/lifecycle shape for dynamic jobs and draft routes:

### Job states

At minimum:
- `ToRoute`
- `AssignedToDraftRoute`
- `ReadyToDispatch` or existing equivalent
- downstream normal dispatch/completion statuses

Exact naming should be aligned to the existing `ucjbStatus` model rather than invented in isolation.

### Route states

Suggested route-level states in RouteBuilder:
- `Draft`
- `Suggested`
- `Locked`
- `Dispatched`
- `Closed`

These can live on the route/run model rather than being forced entirely into job status.

---

## 9. What can be reused from the current SP estate

### Reusable for dynamic mode

These are mostly persistence / commit helpers and can likely remain useful:

- `UTL_stpCourier_Active`
- `UTL_stpJob_tblBulkRun_InsertOrUpdate`
- `UTL_stpJob_tblBulkJobRun_InsertOrUpdate` (or equivalent logic lifted into app services)
- `UTL_stpJob_InsertFromRunBuilder` only as an interim finalisation/commit path if needed during transition
- `UTL_stpJob_tblBulkJob_SyncHDJobs` only where legacy ingestion still matters

### Mostly batch-mode only

These are tied to the old filtered bulk board concept and are not the right backbone for dynamic mode:

- `UTL_stpJob_tblBulkJobWithFilter`
- `UTL_stpJob_tblBulkRunWithFilter`
- `RVW_stpBulkRegions`
- `RVW_stpBulkSpeeds`

These remain relevant for parity work in batch mode, not as the main read model for dynamic mode.

---

## 10. Dynamic mode backend shape

Recommended application-layer services:

- `DynamicPlanningService`
- `DraftRouteRecommendationService`
- `RouteReoptimisationService`
- `DynamicJobIngestionService`
- `ConstraintScoringService`

Suggested DTOs / models:

- `DynamicJobDto`
- `DynamicPlanningRequest`
- `DraftRouteCandidateDto`
- `PlanningRecommendationDto`
- `RouteConstraintProfileDto`
- `RouteWindowProfileDto`

Minimum job data the planner should understand:

- source system
- received timestamp
- pickup and delivery addresses
- geocodes / lat-lng
- target delivery time / ready time / service window
- service minutes
- priority
- depot/origin
- round-trip required flag
- fixed final destination
- fixed sequencing flags if needed

Minimum route/tenant planning parameters the planner should understand:

- route start window
- route end window
- maximum route time
- minimum completion buffer
- tenant rule for whether max route time is hard-stop or soft-stop

---

## 11. Dynamic mode UI shape

Dynamic mode should have its own RouteBuilder workflow rather than pretending to be the same screen with minor tweaks.

Recommended UI elements:

- planning mode switch: `Batch` / `Dynamic`
- **Unplanned / ToRoute jobs rail**
- **Draft routes rail**
- recommendation panel showing:
  - hold
  - append to route
  - create route
  - re-optimise route
- explicit operator actions:
  - accept recommendation
  - override manually
  - freeze route
  - exclude route from auto-replan
- route badges:
  - Draft
  - Suggested
  - Locked
  - Dispatched
- visible route-capacity indicators per draft route:
  - projected route duration
  - route window (e.g. 9:00–12:00)
  - remaining safe capacity
  - warning state when adding another stop would breach the configured limit

Planning and UI work can begin before the full optimisation logic exists.
Using mocked recommendation responses for workflow discovery is acceptable as long as they are clearly labelled as dynamic-mode scaffolding.

---

## 12. External vs internal optimisation

### Keep external

External services can still be used for:
- geocoding
- travel times
- distance matrix
- map rendering
- route geometry

### Bring in-house

The actual dynamic routing/planning brain should move into the RouteBuilder application layer over time, including:

- hold vs assign decisions
- draft route selection
- route creation decisions
- re-optimisation triggers
- fixed-time / fixed-end / round-trip constraint handling

### Reason

The growing constraint set is no longer just “find the shortest stop order”.
It is now a dispatch-planning problem.

---

## 13. Recommended phased delivery

### Phase 1 — batch parity still ships
- complete enough RouteBuilder parity for the current RunBuilder use case
- do not block current operational replacement work

### Phase 2 — dynamic-mode foundation
- add `ToRoute` status to `tucJob`
- audit automation impacts
- define planning mode abstractions
- define dynamic DTOs and service interfaces

### Phase 3 — dynamic-mode UI/workflow
- add dynamic-mode screen / mode switch
- build unplanned jobs rail
- build draft routes rail
- build recommendation panel and manual override controls
- validate operator workflow with Steve before deep optimiser work

### Phase 4 — decision engine
- implement deterministic recommendation logic first
- hold / append / create route / re-optimise decisions
- support core hard constraints
- enforce max route time / route window evaluation as a core recommendation input

### Phase 5 — optimisation maturity
- evaluate OR-Tools / VROOM / similar for in-house constrained optimisation
- keep external distance/time providers where useful

### Phase 6 — full operational integration
- connect live inbound sources
- merge individually booked jobs into draft-route planning
- harden lock/freeze/dispatch behaviour

---

## 14. Decision statement

Dynamic mode should be treated as a **native `tucJob` routing workflow**, not as an extension of the old bulk staging model.

That means:
- insert dynamic jobs directly into `tucJob`
- use a new real job status such as **`ToRoute`**
- preserve the old bulk/SP-backed path for current batch parity where still needed
- build the dynamic planning brain in the RouteBuilder application layer

This gives RouteBuilder the cleanest path to support both:
- the existing prebuild/batch run-building model
- the new rolling/dynamic dispatch model
