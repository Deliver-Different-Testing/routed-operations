# Schedule origin: "Direct" (booking pickup address to delivery address, no depot touch)

**For:** Kevin  **From:** Steve (via EasyEA)  **Date:** 8 October 2026
**Repos:** routed-operations (Schedules NEW chain builder, ScheduleService, Route Builder filters, Bulk Import), dbmigrationsv2 (three single-job booking procs, one CHECK constraint)
**Builds on:** `KEVIN-SCHEDULE-ORIGIN-CLIENT-ADDRESS-2026-10-07.md` (shipped 7 Oct). This is a follow-on, not an addendum: that spec is in production and stays as written.
**Status:** approved by Steve 8 Oct 2026 for build, after the collapse piece. Section 8 recommendations stand as the decisions unless Steve says otherwise in Slack.

---

## 0. TL;DR

| | |
|---|---|
| **The case** | Value Tyres returns, schedule #2900 (Urgent): a driver collects at a Whakatane garage and delivers straight to Value Tyres in Mount Maunganui. One job, one driver, no depot touched. Same shape as a growing class of regional direct runs. |
| **What works today** | #2900 already books one job with the garage as From and Value Tyres as To, rated on the Regional Run delivery speed by zone. Nothing physically goes through the Tauranga depot. |
| **What is wrong** | Two things. (1) The chain says "Depot Tauranga, then Delivery", which reads as via-depot. The meeting on 8 Oct nearly reconfigured it as a Collection leg because of that label, which would have split it into two jobs and re-rated it. (2) It only keeps the garage address because the client's speed setting has Book immediately on. For a client with that off, the single-job procs stamp the depot's address and coordinates on the job. The shape works by accident. |
| **Fix** | A third value on the first Depot leg next to Depot and Client address: **Direct**. Stored as `OriginType = 'direct'` on the header (fits the existing CHAR(6), extend the CHECK). Chain renders truthfully, the schedule is validated as single-leg, and the three single-job procs keep the booking's declared From address regardless of Book immediately. Route Builder and Bulk Import admit it by its dispatch region. |
| **Size** | Small. Every touch point is one Kevin built last week for 'client'; this adds a second value to each. One CHECK migration, one SP re-emit of the three procs, four app files. |
| **Not changed** | 'depot' and 'client' behaviour, the Collection leg, the bulk/prebook path (already correct), rating. |

---

## 1. The case and what happens today

Schedule #2900 "Value Tyres Returns Whakatane > Tauranga": Mon to Fri, 12:00 to 17:00 window, cutoff 11:00 same day, dispatch region Tauranga, speed Regional Run, delivery zone 1, no Collection leg, no linehaul, Book immediately on. Linked client VALUA.

A booking as VALUA from Nicholson United Autos (Whakatane 3120) to Value Tyres (Mount Maunganui 3116) produces one job, From the garage, To Value Tyres, priced NZ$14.56 on the delivery speed. Anisah's screenshots of 8 Oct show exactly that. Operationally the same driver does both ends; the Tauranga depot is where the run is dispatched and reported, not somewhere the parcel goes.

**Why it works.** The three single-job booking procs overwrite the booking's From with the schedule region's depot unless a flag says not to. The guard, as re-emitted in `20261007140000_ClientOrigin_SingleJobKeepsClientAddress`:

```sql
@DONOTOverwriteSceduleFromAddress = ISNULL(BookImmediate, 0)   -- from UTL_fncJob_GetClientAvailableSpeed(@ClientID, @JobTypeID, @BookDate)
@IsCollectFromClientAddress = CASE
    WHEN ISNULL(h.OriginType, 'depot') = 'client' THEN 1
    WHEN ISNULL(s.BookPickup, 0) = 1 AND s.PickupDepotId IS NULL THEN 1
    ELSE 0 END
IF (@DONOTOverwriteSceduleFromAddress = 0 OR @JobTypeID IN (94, 95, 110)) AND @IsCollectFromClientAddress = 0
    -- overwrite From address, suburb, postcode, country, PickUpLatitude/Longitude with the s.Region depot's
```

`BookImmediate` is the **client's speed setting** (Admin Manager, Available Services), not the schedule's checkbox. So #2900 keeps the garage address because VALUA has Book immediately on for Regional Run. Link a client that has it off, or use one of the three home-delivery speeds (94, 95, 110 on NZ), and the same schedule stamps the Tauranga depot's address and coordinates on the job. The driver is then sent to the depot, and Route Builder admits the job to Tauranga for the wrong reason (depot coordinates), which is the same failure the client-origin spec's acceptance 1 was written to catch.

The bulk/prebook path (`WS_/DD_stpBulkScheduleJob_Insert`) does not have this problem: with BookPickup = 0 and no linehaul it falls through to the booking's own address, as the 7 Oct migration header records.

**The meeting's proposal (8 Oct)** was "a collection leg followed by a depot set to client address". That is the wrong shape for this job: a Collection leg sets BookPickup = 1, which creates a pickup job into the depot plus a delivery job out of it, two jobs, with the pickup half rated on the pickup rating speed. It is the two-job split and the pricing change the same meeting said it wanted to avoid. The confusion came from the chain label, which is what this spec fixes.

---

## 2. Three origins, side by side

The first Depot leg already carries a dropdown with Depot and Client address (ChainBuilder, first-depot card). Direct is the third value.

| | **Depot** (default) | **Client address** (7 Oct) | **Direct** (this spec) |
|---|---|---|---|
| Meaning | goods leave from the dispatch depot | goods leave from the client's own site (warehouse / DC) | goods leave from wherever the booking says, straight to the delivery address |
| `OriginType` | 'depot' | 'client' | 'direct' |
| Job From address | the Region depot | the booking's declared From (client master is the usual value) | the booking's declared From, always |
| From coordinates | depot | booking | booking |
| Collection leg | allowed | not allowed | **not allowed** |
| Linehaul legs | allowed | allowed (loads at client site) | **not allowed** |
| `OriginRegionId` | null | required | null |
| `Region` (dispatch) | the Depot leg's depot | the Delivery leg's depot | the Depot leg's depot, relabelled "Dispatch region" |
| Route Builder admits by | depot coordinates / `tblBulkJob.RegionID` | `OriginRegionId` | **`tblBulkJob.RegionID`** |
| Bulk Import From | the Region depot | client site (`RouteFromClientSite` implied) | **the import row's own From** |
| Can be default | yes | no (address is client-specific) | **yes** (address comes from each booking) |
| Rating | delivery speed by zone | delivery speed by zone | delivery speed by zone, unchanged |

**On "booking-declared" history.** A third pickup-source option called booking-declared shipped on the Collection leg until 5 Oct and was removed because it could not round-trip: the Collection leg persists only `PickupDepotId`, so the choice saved as null and reloaded as Client address (ChainBuilder header comment). Direct does not repeat that mistake: it lives on the Depot leg and persists a real value in `OriginType`. It also does not settle F12 (booking-declared versus client master on the linehaul `FromClientAddress`), which stays open with Steve; Direct has no linehaul leg, so the question does not arise for it.

---

## 3. Changes: database (dbmigrationsv2)

**M1. CHECK vocabulary.** Replace `CK_tblBulkRunScheduleHeader_OriginType` with `CHECK (OriginType IN ('depot', 'client', 'direct'))`. Drop and re-add inside the existing idempotent guard pattern; no data change, no `procRefreshAllViews` (no table shape change).

**M2. Three single-job procs.** `WS_stpJob_Insert`, `WS_stpJob_Topup_Insert`, `DD_stpJob_InsertExcelerator`. One expression each, same spot the 7 Oct migration touched:

```sql
@IsCollectFromClientAddress = CASE
    WHEN ISNULL(h.OriginType, 'depot') IN ('client', 'direct') THEN 1
    WHEN ISNULL(s.BookPickup, 0) = 1 AND s.PickupDepotId IS NULL THEN 1
    ELSE 0 END
```

Baseline each body from `20261007140000` (the last emitter) and collision-review against it. Blast radius: none on existing data; no header carries 'direct' until the app writes it.

**M3. Nothing for the bulk path.** Assert in the migration header, as 7 Oct did, that `WS_/DD_stpBulkScheduleJob_Insert` already fall through to the booking address when BookPickup = 0 and no linehaul. No re-emit.

Numbering: after the latest file on develop at the time of writing.

---

## 4. Changes: app (routed-operations)

| # | File | Change |
|---|---|---|
| A1 | `Core/Application/Dtos/Schedule/ScheduleRequests.cs` (OriginType, `[StringLength(6)]`) | accept 'direct'. |
| A2 | `Core/Application/Services/Schedule/ScheduleService.cs` ~1135-1191 (origin write) | `originType` resolves 'direct' as well as 'client'. Validation for 'direct': no Collection leg (`bookPickup` must be false), no linehaul legs in the request, `OriginRegionId` forced null. Default allowed (section 8, D1). Error text names the rule: "A Direct schedule books one job from the pickup address given at booking time; remove the Collection and linehaul legs or choose Depot." |
| A3 | `ScheduleService.cs` ~1477 (copy) and ~1912 (read) | copy carries 'direct' across unchanged (unlike 'client', there is no client-specific address to lose); read returns it. |
| A4 | `wwwroot/app/react/components/schedules-new/ChainBuilder.tsx` ~725 (first-depot `<select>`) | add `<option value="direct">Direct (pickup address from the booking)</option>` on the first Depot card only. Card renders "Direct: booking pickup address, dispatched from {depot}". The Add Collection and Add Linehaul buttons disable with the same tooltip pattern used for client origin (~468). |
| A5 | `ScheduleDetailModal.tsx` ~196 / `NewScheduleModal.tsx` ~283 (derive `originType` from the chain) | three-way: client card selected = 'client', direct selected = 'direct', else 'depot'. `seedLegsFromDto` seeds the dropdown from the stored value. |
| A6 | `Core/Application/Services/Run/RunService.cs` ~122 and `Core/Application/Services/Job/JobService.cs` ~136, ~351 (Route Builder region admission) | the 7 Oct clause admits client-origin jobs by `h.OriginType = 'client' AND h.OriginRegionId IN @regions`. Add the sibling: `h.OriginType = 'direct' AND bj.RegionID IN @regions`. A Direct job's pickup coordinates are wherever the booking says, so the coordinate test cannot be relied on. |
| A7 | `Core/Application/Services/BulkImport/BulkImportJobFactory.cs` ~616-620 (routed origin precedence) | for 'direct', use the import row's own From address and coordinates; do not substitute the Region depot and do not imply `RouteFromClientSite`. Refuse the row if it has no From address, same message style as the client-origin geocode refusal. |
| A8 | Schedules NEW list, ORIGIN column | shows "Direct". |

Tests: one Playwright E2E extending `tests/e2e/schedule-origin-and-polygons.spec.ts` with an `originType: 'direct'` case (save, reload, chain shows Direct, Collection and Linehaul disabled); vitest on the three-way derive in A5.

---

## 5. Moving #2900 and its lookalikes

No data migration. Ops opens each schedule, sets the first Depot leg to Direct, saves. Candidates are per-client schedules with no Collection leg and no linehaul whose bookings' From is not the depot. Read-only, Urgent Prod:

```sql
SELECT h.ScheduleId, h.Name, h.OriginType, s.Region, r.Name AS DispatchRegion,
       COUNT(*) AS DayRows
FROM dbo.tblBulkRunScheduleHeader h
JOIN dbo.tblBulkRunSchedule s ON s.ScheduleId = h.ScheduleId
LEFT JOIN dbo.tblBulkRegion r ON r.BulkRegionId = s.Region
WHERE h.RetiredUtc IS NULL
  AND h.IsDefault = 0
  AND h.OriginType = 'depot'
  AND ISNULL(s.BookPickup, 0) = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.tblBulkScheduleLinehaul l
                  WHERE l.BulkRunScheduleId = s.BulkRunScheduleId AND l.Active = 1)
GROUP BY h.ScheduleId, h.Name, h.OriginType, s.Region, r.Name
ORDER BY r.Name, h.Name;
```

Most of those will be genuine depot-origin schedules (goods already at the depot). Ops knows which ones are driver-direct. #2900 is one.

---

## 6. Acceptance (Urgent staging, then production)

1. Open #2900, set the first Depot leg to Direct, save, reload: dropdown shows Direct, Collection and Linehaul controls disabled, list ORIGIN column reads Direct.
2. Book as VALUA from Nicholson United Autos to Value Tyres with the client's Book immediately **on**: job From = the garage, `PickUpLatitude/Longitude` = the garage, price NZ$14.56. Same result as today.
3. Same booking with Book immediately **off** for VALUA on Regional Run (staging only): identical job. Today this case stamps the Tauranga depot; after M2 it must not.
4. Same booking on a home-delivery speed (94, 95 or 110) if one is linked: identical From. Today these overwrite regardless of Book immediately.
5. Prebook path: an occurrence materialised by `uspPrebookSet` carries the garage as From (regression; already true).
6. Route Builder, region Tauranga, the job's date: the job is listed. Route Viewer Overview counts it under Tauranga.
7. Bulk Import against a Direct schedule: the row's From is kept; a row with no From is refused with a reason.
8. Regression: a depot-origin and a client-origin schedule booked before and after the deploy produce byte-identical jobs.

---

## 7. Why not fold this into the collapse

The collapse keeps `OriginType` on the header (decided 8 Oct), so nothing here conflicts with it and nothing here waits for it. It is a week's worth of operator confusion avoided for a small change, and it removes a latent mis-stamp that is live today for any client with Book immediately off.

---

## 8. Decisions

| # | Question | Recommendation |
|---|---|---|
| D1 | May a Direct schedule be a default (IsDefault = 1)? | **Yes.** Unlike client origin, the address comes from each booking, so a default Direct schedule is coherent (a generic "regional direct" offer). Keep the 7 Oct rule that client origin cannot be default. |
| D2 | Dropdown wording | "Direct (pickup address from the booking)". Card: "Direct: booking pickup address, dispatched from {depot}". |
| D3 | Does Direct become the F12 answer? | **No.** F12 is booking-declared versus client master on the linehaul leg. Direct has no linehaul leg. Leave F12 open as it is. |

---

## 9. Out of scope

- Any change to 'depot' or 'client' behaviour, or to the Collection leg's two-state pickup source.
- Rating. A Direct job rates exactly as today.
- Converting a Direct schedule to depot-plus-Collection when a local driver takes over the run (Value Tyres, if volume grows). That is a re-rate and a commercial decision; the UI already supports the target shape.
- The "View as" client filter (F16) and the speed list rework raised in the same meeting. Separate items.
