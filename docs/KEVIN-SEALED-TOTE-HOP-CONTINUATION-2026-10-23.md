# Sealed Tote Hop Continuation - Spec (Kevin)

_Author: Steve Bonnici (with EasyEA) - 2026-10-23. Owner: Kevin (dbmigrationsv2). Size: about a day._
_Extends: `KEVIN-FINAL-MILE-TOTE-SCANNING-2026-10-16.md` (same folder). Baselines are "latest emitter on master at build time"; at the time of writing that is `20261021142000` for all four procs below._
_Revised 23 Oct 15:45 after Kevin's review: insertion point (2.1), `RunName` (2.4), the Urgent claim (2.5), the self-loop case (5), and the tenant / run switches Steve decided (2.7, 3)._

## 1. Problem

Medical packs samples into boxes at the Oakland depot, seals them for airfreight, and nobody opens them again until the lab. In the system that box is a linehaul tote, and the chain it travels is four linehaul runs then the final-mile route (P5174 on Medical prod, 23 Oct):

| Leg | Run | From | To |
|---|---|---|---|
| LH1 | 9 Hayward to Oakland | Hayward Response Center (36) | Oakland (37) |
| LH2 | 13 Oakland to Oak Airport | Oakland (37) | Oakland Airport (42) |
| LH3 | 11 Oak to Burbank (the flight) | Oakland Airport (42) | Burbank Airport (43) |
| LH4 | 14 Bur Airport to Burbank | Burbank Airport (43) | Burbank (38) |
| DEL | route 15 | Burbank (38) | lab |

Every tote inwards today closes the tote (`IsClosed = 1`) and the next run expects a fresh tote packed at that depot. `20261021142000` lets a tote continue past Burbank onto route 15, but only there. At Oakland Airport and Burbank Airport the sealed box would have to be repacked, which cannot happen. Steve's decision 23 Oct: keep the airport runs (the overseer must see the box consigned on the flight), so a sealed tote has to continue across **every** linehaul hop.

## 2. Design

### 2.1 Where

The four tote-closing paths, same files as `20261021142000`: `MARSWS_stpLinehaulToteInwards`, `MARSWS_stpLinehaulToteInwardsItem` (Done path), `MARSWS_stpLinehaulToteInwardsClose` (COMPLETE path only), `MARSWS_stpLinehaulLocationReceipt` (tote path). In the shipped procs the final-mile check and the tote close both sit **before** `MARSWS_stpLinehaulToteMarkInwardedAndDeriveMaster`, so the block cannot literally sit between them (Kevin, 23 Oct). The constraint that matters: the arriving run's master completion is evaluated inside the derive-master call on this tote's `InwardedAt`, so the **re-bind must run after that call**. Kevin's arrangement, same outcome and same transaction: resolve the next run early (2.2), use it to hold off both the close and the final-mile branch, then re-bind after the derive-master call. The leg completion must also run before the next-run resolution, which the self-loop case in section 5 depends on.

### 2.2 Rule

The tote continues on run R when, for **every** active root in the tote (`tblLinehaulToteItem.SourceJobId`, `RemovedAt IS NULL`), there is a leg with `LinehaulRunId = R`, `ISNULL(ucjbJobDone,0) = 0`, `ISNULL(ucjbVoid,0) = 0`, and `R.FromDepotId = @ToDepot` of the arriving run (`tblbulkLinehaulRun.ToDepotId`), and R is the same for all roots. This is the adjacency rule `20261014172000` already uses to pick the pack target.

```
@Cand (Root, NextRun) = roots x not-done legs on runs departing @ToDepot
continue  = every root appears in @Cand
        AND COUNT(DISTINCT NextRun) = 1
```

Anything else (a root with no onward leg, roots bound for different runs) falls through to the existing final-mile check and then closes as today. The SHORT / close-with-missing path never continues: a box that is short has been opened, and the items are handled individually as today.

### 2.3 Re-bind

```sql
UPDATE dbo.tblLinehaulTote
SET LinehaulRunId = @Next,
    PickedUpAt = NULL, PickedUpByCourierId = NULL,
    MasterJobId = NULL,
    InwardedAt = NULL, InwardedByCourierId = NULL
WHERE LinehaulToteId = @ToteId;   -- IsClosed stays 0, ClosedAt stays NULL, FinalMileRouteId untouched

UPDATE dbo.tblLinehaulToteItem SET LinehaulRunId = @Next
WHERE LinehaulToteId = @ToteId AND RemovedAt IS NULL;
```

Audit one `tblBulkScan` row the way the inwards procs already do, payload `TOTE:<barcode>|HOP:<arrivingRun>><nextRun>` (`LEFT(,50)`), so the hop history is readable in Scan Manager.

### 2.4 Result shape

Two trailing columns on **every** return path of the four procs, after `FinalMileRouteId`: `NextLinehaulRunId INT NULL`, `NextRunName NVARCHAR(100) NULL` (`tblbulkLinehaulRun.RunName`, which is `NVARCHAR(100)`). Non-null only when the tote continued on a linehaul hop. marsapi maps by name and ignores extras until Garry adds the two properties; the handset then shows "Tote continues on {NextRunName}" instead of "Leg complete" (Garry, folded into M4 wording).

### 2.5 Why nothing else changes (checked in the shipped procs)

- **Arriving run's master** still completes: `20260706120000` counts totes on that run with `PickedUpAt` set and `InwardedAt NULL`; the check runs on this tote's stamp before the re-bind (2.1).
- **Pickup on R** (`20261014171000`): the tote now carries R, every root has a leg on R, so `PICKED_UP` fans status 5 over R's legs; `FINAL_MILE` only fires on `FinalMileRouteId`, which stays NULL.
- **Depart gate on R** (`20260715120000`): reconciles the origin pickup item scans (`tblScan`, Status 0) against the items in this master's picked-up totes. A sealed tote keeps both, so it passes without rescanning.
- **Next inwards**: the idempotent `InwardedAt IS NULL` stamp works again because the re-bind cleared it, and R's master completion counts the tote correctly.
- **Pickup counts** (`RunToteCount`, "X of Y totes"): keyed on `LinehaulRunId = R` and `InwardedAt NULL`, so the continued tote is counted for R.
- **Final-mile continuation at Burbank** (`20261021142000`): no run departs depot 38, so the new block finds nothing and the existing route-15 check runs exactly as now.
- **Urgent**: the first draft claimed no Urgent run departs another run's destination. Wrong: 66 of 74 runs on Urgent production and 48 of 52 on staging arrive at a depot that has a departing run (Kevin, 23 Oct). What keeps Urgent unchanged today is that it has no totes at all. The protection is therefore the switches in 2.7, default off, not the data.

### 2.6 Guards

Unchanged: `NO_TOTE`, `TOTE_CLOSED`, `WRONG_LOCATION` and the location QR / drop-off rules from `20261014170000`.

### 2.7 Switches (Steve, 23 Oct): optional by tenant and by run

The block runs only when the effective switch is 1; otherwise the four procs behave exactly as today.

| Switch | Where | Meaning |
|---|---|---|
| `SealedToteContinuationEnabled BIT NOT NULL DEFAULT 0` | `tblSetting` (single-row per-tenant settings table, pattern `20261007200000`) | tenant default |
| `SealedToteContinues BIT NULL` | `tblbulkLinehaulRun`, read on the **arriving** run | NULL = follow the tenant setting; 1 = totes arriving on this run continue; 0 = never |

`effective = COALESCE(arrivingRun.SealedToteContinues, tblSetting.SealedToteContinuationEnabled)`. Default 0 everywhere, so no tenant changes behaviour by applying the migration. Medical switches it on for the test with one UPDATE on the tenant row, or on runs 13 and 11 only. No UI in this spec; the Linehaul run editor can grow the flag later.

### 2.8 Open with Steve: the short path on the existing final-mile check

Kevin, 23 Oct: the route-15 check shipped in `20261021142000` runs even when a tote is closed short, so a tote with items missing at Burbank can already be bound to `FinalMileRouteId`. This spec's hop never continues on the short path. Whether to align the existing final-mile check (close short, go per item, as the parent spec says) is Steve's call; Kevin leaves it as shipped until told.

## 3. Schema

Two guarded column adds (2.7): `tblSetting.SealedToteContinuationEnabled` and `tblbulkLinehaulRun.SealedToteContinues`. Otherwise procs only. `SET QUOTED_IDENTIFIER ON` + `ANSI_NULLS ON`, `CREATE OR ALTER`, `GRANT EXECUTE TO [Web]`, tenant-neutral.

## 4. Medical setup (data, with Kenneth)

1. Location QR codes (`LOC~name~depotId~...`) printed and posted at Oakland Airport (42) and Burbank Airport (43), or a `tblDropOffLocation` configured on runs 13 / 11 / 14 in `tblBulkScheduleLinehaul`. Without one the inwards scan refuses `WRONG_LOCATION`.
2. Masters for runs 13, 11 and 14 assigned to the drivers who scan them: 13 and 11 to the Oakland-side driver (inwards at the airport, then pickup on the flight master), 14 to the Burbank collection driver. The pickup proc refuses `NOT_ASSIGNED` otherwise.
3. Route 15's master and delivery mode set in the route editor (M5).

## 5. Test plan (Medical staging)

1. One box: pack at Oakland for run 13, pickup, Done. Inwards at 42 -> `LEG_COMPLETE`, `NextLinehaulRunId = 11`; tote `IsClosed = 0`, `LinehaulRunId = 11`, `PickedUpAt / MasterJobId / InwardedAt` NULL; run 13 master Done.
2. Pickup on the run 11 master -> `PICKED_UP`, LH3 legs at 5; Done -> master 11 at 5 (consigned on the flight) with no item rescans.
3. Inwards at 43 -> continues on 14; pickup on 14; inwards at 38 -> `FinalMileRouteId = 15`, `NextLinehaulRunId NULL` (existing behaviour).
4. Mixed box (one root with no run-11 leg) inwarded at 42 -> closes as today, `NextLinehaulRunId NULL`.
5. Item inwards at 42 with one item missing, Close -> `SHORT`, tote closed, no continuation.
6. Regression: a run-9 tote inwarded at Oakland whose roots' next legs are on run 13 -> continues (first hop of the chain, wanted); with the tenant switch 0 and no run override, the same tote -> closes as today; run override 0 on run 13 with tenant switch 1 -> closes.
7. Self-loop (Kevin): run 12 "CS Logistics" departs and arrives at depot 39, so "runs departing this run's destination" includes the arriving run itself. Safe only because leg completion runs first and clears that run's legs; the test pins that ordering.

## 6. Deploy

dbmigrationsv2 only, ahead of marsapi; the two extra columns are ignored until Garry maps them. Medical staging first, then prod before the tenant test next week.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| H0 | Migration on GitLab master, applied to Medical staging | the four procs return `NextLinehaulRunId` / `NextRunName`; both switch columns present, default 0 |
| H1 | Staging run-through, test plan 1-6 | one box Oakland -> lab on staging with no repack |
| H2 | Medical prod: migration applied, switch on (tenant or runs 13 + 11), airport location QRs posted, masters 13 / 11 / 14 assigned | Kenneth's first live box reaches Burbank still open |
| H3 | Garry: two properties in marsapi, "Tote continues on {run}" on the inwards page (part of 4.0) | handset shows the run name at the airport |
