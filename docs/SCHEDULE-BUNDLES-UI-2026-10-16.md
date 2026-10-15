# Schedule bundles: make the tab usable

**Date:** 16 Oct 2026. **Source:** Steve, 16 Oct ("you have to remember the schedule id, which is not ideal").
**Owner:** Kevin (owns Schedules NEW). **Mock:** https://deliver-different-testing.github.io/routed-ops-pricing-mock/?tab=bundles&bundle=1
**Sits beside:** `PRICING-AND-ZONES-INTO-ROUTED-OPS-2026-10-09.md` (same branch); the 6.1 default-schedule rule applies here.

## 1. What a bundle is

The same idea as a rate card in Settings: a named set of local and nationwide schedules that fits a
client profile. A new medical client arrives, ops opens the "Medical nationwide" bundle and adds the
client, and the client is linked to every schedule in it in one go.

The structure already captures this and does not change:

- `tblBulkRunScheduleBundle` (BundleId, Name, Description, IsActive, CreatedUtc, CreatedBy)
- `tblBulkRunScheduleBundleMember` (BundleId, ScheduleId) -> `tblBulkRunScheduleHeader`
- The bundle never holds clients. Adding a client writes one `tblScheduleClient` row per
  non-default member (`ScheduleService.AttachClientsToBundleAsync`, idempotent, defaults skipped).

## 2. What is wrong with the tab today (`SchedulesNew.tsx:1150-1600`)

| Today | Problem |
|---|---|
| Expand-in-place card: name, counts, chips of "#id - name" | No way to see what a member schedule is (depot, speed, days, who can book) without leaving the tab. |
| "Add member" is `window.prompt` for a schedule id (`handleAddMember`, line 1215) | Nobody knows schedule ids. |
| "Rename" is `window.prompt` (line 1209) | Description cannot be edited from the UI at all. |
| "Attach clients" opens a `ClientMultiPicker` modal | Fine as a picker, but the tab never shows **which** clients are on the bundle, only a count (`ScheduleBundleDto.ClientCount`, a distinct count across members). |
| No way to remove a client from a bundle | Ops has to open each member schedule and detach there. |
| No way to tell a client is only on some members | A client attached before a schedule joined the bundle is on n of m members and nothing shows it. |

## 3. Target UI

Overview stays a list (name, description, schedule count with how many are defaults, client chips,
Active / Inactive, Open). Everything else moves into a **bundle modal**:

```
Medical nationwide  [Active]  Bundle #1                                   [Rename] [Deactivate] [Delete bundle]
Hamilton, Wellington and Christchurch 8am / overnight for medical device clients.

Schedules in this bundle · 4                   [+ Schedule]   Clients on this bundle · 3            [+ Client]
Schedule                 Who can book  Depot   Speed  Days     ZIM  Zimmer Biomet   On all 2 client schedules   [Remove]
AKL 8am                  All clients   AKL     8am    MTWTF    STRY Stryker         On all 2 client schedules   [Remove]
Medical Hamilton 8am     All clients   HAM     Ham    M-W-F    NUVA NuVasive        On 1 of 2 client schedules  [Complete] [Remove]
Medical WLG 8am          2 linked      WLG     8am    MTWTF
Medical CHC Overnight    3 linked      CHC     O/N    MTWTF
```

- **+ Schedule** is a searchable picker over live, non-retired headers (name, depot, speed, default
  marker). No ids typed. Adding a non-default schedule to a bundle that already has clients asks
  "link the N clients on this bundle to it too?" (yes = one link row per client; no = they show as
  "on n of m" until completed).
- **Schedule row**: name opens the schedule modal (existing `openBase`); "Who can book" is
  "All clients" for `IsDefault = 1` (6.1 wording) or the link count; Remove takes the member row out
  and touches nothing else (existing behaviour, keep the confirm).
- **+ Client** is the same searchable picker. Adding writes a link row per non-default member
  (existing endpoint). Disabled with a tooltip when every member is a default.
- **Client row** shows coverage: "On all m client schedules" or "On n of m" in orange with a
  **Complete** action that links the missing members. **Remove** deletes the client's link rows on
  every member of the bundle. Whether the client's `tblBulkRunScheduleOverride` rows go with the
  link is **to confirm**: `DetachClientAsync` (`ScheduleService.cs:2165`) removes only the link row
  today, so either the FK cascades or orphan override rows are already being left behind. The
  bundle remove should do whatever the single detach does, and both should be the same.
- Rename and description edit inline in the modal header; Deactivate / Activate toggles
  `IsActive`; Delete keeps the existing confirm text.

## 4. API

Existing and kept: `GET /v2/schedule-bundles`, `POST /v2/schedule-bundles`,
`PUT /v2/schedule-bundles/{id}`, `DELETE /v2/schedule-bundles/{id}`,
`POST /v2/schedule-bundles/{id}/members`, `DELETE /v2/schedule-bundles/{id}/members/{scheduleId}`,
`POST /v2/schedule-bundles/{id}/clients`.

New:

```
GET /v2/schedule-bundles/{id}
  -> { bundleId, name, description, isActive,
       members: [{ scheduleId, name, isDefault, depotId, depotName, speedId, speedName, dayMask, cutoff, clientCount }],
       clients: [{ clientId, code, name, onMembers, ofMembers }] }
     clients = DISTINCT ClientId over tblScheduleClient rows whose ScheduleId is a non-default live member;
     ofMembers = count of non-default live members; onMembers = this client's link rows among them.

DELETE /v2/schedule-bundles/{id}/clients/{clientId}
  -> removes tblScheduleClient rows for that client on every live member of the bundle
     (override rows: same rule as DetachClientAsync, see section 3); returns { removed }.

POST /v2/schedule-bundles/{id}/members  (existing) gains optional body flag
  { scheduleIds: [...], linkExistingClients: true }
  -> after inserting the member rows, for each non-default new member, insert a link row for every
     client currently on the bundle (the GET's clients list). Idempotent like AttachClientsToBundleAsync.
```

"Complete" on a client row is `POST /v2/schedule-bundles/{id}/clients` with that one client; the
existing idempotency makes it fill only the gaps.

## 5. Interaction with the pricing spec

- 6.1: a default member stays "All clients" after a client is configured on it; the bundle skips
  it when linking because the client already books it. If a client needs an override on a default
  member, that is still done on the schedule (Configure for client).
- 6.2 suppression: a client linked through a bundle is "configured" on those lanes and speeds, so
  the defaults for the same lane and speed stop showing for that client. That is the intended
  effect of putting them on the bundle; say so in the + Client confirmation.
- Rate sheets (11.1) are per zone group and client, not per bundle. A bundle could later carry a
  default rate sheet per group to assign at the same time; not in this item.

## 6. Acceptance

1. Open a bundle, add a schedule by name, add a client by name: the client gains one link row per
   non-default member and none on defaults; the overview count matches.
2. Add a non-default schedule to a bundle with three clients and answer yes: three link rows
   appear on it; answer no: the three clients show "On n of m" with Complete.
3. Remove a client from the bundle: its link rows on every member are gone, other clients
   untouched, the schedule rows themselves untouched.
4. No `window.prompt` left on the tab.
