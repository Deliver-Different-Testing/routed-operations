# Historic Archive Upload: resolve ClientCode to ucjbClientID at commit

**For:** Kevin
**From:** Steve (drafted with Claude), 2026-10-08
**Repo:** routed-operations (`gitlab.com/deliver-different`, mirror `Deliver-Different-Testing/routed-operations`)
**Priority:** Must land before the OTG Live load. Staging rows have already been patched by SQL (Kerran, 8 Oct).

---

## 1. Problem

`HistoricArchiveService.CommitAsync` never resolves the mapped `ClientCode` to a `tucClient.ucclID`. Every imported `tucJobArchive` row lands with `ucjbClientCode` populated and `ucjbClientID = NULL`.

The DTO comment already promises the lookup, so the behaviour is a bug, not a design choice:

```csharp
// Core/Application/Dtos/HistoricArchive/HistoricArchiveDtos.cs
public const string ClientCode = "ClientCode"; // -> UcjbClientCode (used to look up UcjbClientId)
public const string ClientId   = "ClientId";   // -> UcjbClientId (bypass lookup if operator supplies the int)
```

But `BuildRow` only does:

```csharp
UcjbClientCode = clientCode,
UcjbClientId   = OptInt(raw, canonicalToHeader, HistoricArchiveField.ClientId),
```

### Why it matters

- **No customer on the job.** Every reader keyed on `ucjbClientID` misses the rows: Accounts revenue report (`RevenueReportService` requires `j.ClientId.HasValue` on every query), customer-scoped job views, client financial summary.
- **It cannot be fixed after the fact.** `tucJobArchive_Update_BlockChanges` rolls back any `UPDATE` of `ucjbClientID` when `ucjbInvoiceNo <> 0`, `OriginalInvoiceId IS NULL` and the login is not `AccountsService`. Imported rows carry the sentinel `ucjbInvoiceNo = 999999`, so they always match. Kerran had to disable the trigger to patch staging. The value has to be right at insert time.

Evidence: OTG staging load on 8 Oct 2026 (5 batches, 20,540 rows, `SourceID = 900`), all with `ucjbClientID IS NULL` before Kerran's patch.

## 2. Change

One file: `Core/Application/Services/HistoricArchive/HistoricArchiveService.cs`. No DTO, controller, frontend or migration changes. The `TucClient` entity already exposes `UcclId`, `UcclCode`, `UcclName`, `UcclActive` (partials in `Core/Domain/Despatch/TucClient.*.cs`), and `DespatchContext.TucClients` exists.

### 2.1 Preload a tenant-local code to id lookup in `CommitAsync`

Same pattern as the existing `serviceNameToSpeedId` / `vehicleNameToSizeId` dictionaries, in the same `lookupCtx` block:

```csharp
Dictionary<string, int> clientCodeToId;
await using (var lookupCtx = await contextFactory.CreateDbContextAsync())
{
    // ...existing serviceNameToSpeedId / vehicleNameToSizeId hydration...

    clientCodeToId = (await lookupCtx.TucClients
            .AsNoTracking()
            .Where(c => c.UcclCode != null && c.UcclCode != "")
            .Select(c => new { c.UcclCode, c.UcclId })
            .ToListAsync())
        .GroupBy(x => x.UcclCode.Trim(), StringComparer.OrdinalIgnoreCase)
        .ToDictionary(g => g.Key, g => g.OrderBy(x => x.UcclId).First().UcclId,
                      StringComparer.OrdinalIgnoreCase);
}
```

Rules:

- **Do not filter on `UcclActive`.** Historic imports legitimately reference clients that are now inactive (21 of OTG's 78 clients are inactive). This differs from `BulkImportStaffImport`, which only matches active clients, and that difference is intentional.
- **Case-insensitive, trimmed.** `tucClient.ucclCode` collation is case-insensitive; match that in memory.
- **Duplicate codes: lowest `ucclID` wins**, and log one `Log.Warning` per duplicated code at commit so ops can see it. Do not throw. (The existing service/vehicle dictionaries use "first seen"; lowest id is deterministic and preferred here.)

### 2.2 Resolve in `BuildRow`

Add the dictionary to the `BuildRow` signature and resolve with explicit `ClientId` taking precedence:

```csharp
private static TucJobArchive BuildRow(
    Dictionary<string, string?> raw,
    Dictionary<string, string> canonicalToHeader,
    Dictionary<string, int> serviceNameToSpeedId,
    Dictionary<string, int> vehicleNameToSizeId,
    Dictionary<string, int> clientCodeToId)
{
    var jobNumber  = RequireString(raw, canonicalToHeader, HistoricArchiveField.JobNumber);
    var jobDate    = RequireDate(raw, canonicalToHeader, HistoricArchiveField.JobDate);
    var clientCode = RequireString(raw, canonicalToHeader, HistoricArchiveField.ClientCode);

    var clientId = OptInt(raw, canonicalToHeader, HistoricArchiveField.ClientId)
                   ?? (clientCodeToId.TryGetValue(clientCode, out var resolved)
                        ? resolved
                        : throw new InvalidOperationException(
                            $"Client code '{clientCode}' does not match any client in this tenant."));
    // ...
    UcjbClientCode = clientCode,
    UcjbClientId   = clientId,
```

**Unresolved code rejects the row.** This is the decision point. Silently leaving `ucjbClientID` NULL reproduces today's bug and, because of the trigger, cannot be repaired later. Rejection goes through the existing per-row error path, so the operator gets the row in the batch's error CSV, creates the missing client, and re-uploads just those rows. The rejection message must name the code so the operator can act on it without opening the file.

If the operator maps an explicit `ClientId` column, it wins and no lookup is done for that row (matches the DTO comment). Do not validate that an explicit id exists; that is the operator's responsibility, as today.

### 2.3 Audit batch

No schema change. `HistoricArchiveImportBatch.Errors` already persists the rejection reasons, and `GetBatchesAsync` already projects distinct `ucjbClientCode` values. Nothing to add.

## 3. Tests

`tests/RoutedOperations.Tests/Services/HistoricArchive/HistoricArchiveServiceTests.cs` (InMemory harness; `CommitAsync` tests that hit `SqlQueryRaw` are `Skip`ped there, so put the resolution logic where the existing `OtgHistoricCsv_ParseAndBuildRow_LandsEveryMappedFieldCorrectly` test can reach it, or test `BuildRow` via the same internal seam that test uses).

Add:

1. **Code resolves.** Seed `TucClients` with `{ UcclId = 42, UcclCode = "445" }`. Row with `ClientCode = "445"` lands `UcjbClientId = 42` and `UcjbClientCode = "445"`.
2. **Case and whitespace.** Seed `"CAP01"`, row has `" cap01 "`. Resolves to the same id.
3. **Unresolved code is rejected.** Row with `ClientCode = "NOPE"` appears in `Errors` with `RowIndex`, `JobNumber` and a message containing `'NOPE'`; `RejectedCount` increments; no archive row inserted for it; other rows in the same batch still insert.
4. **Explicit ClientId wins.** Mapping includes both `ClientCode = "445"` (resolves to 42) and `ClientId = "7"`. Row lands `UcjbClientId = 7`.
5. **Inactive client resolves.** Seed `{ UcclCode = "72", UcclActive = false }`. Resolves.
6. **Duplicate codes.** Seed two clients with code `"NEW"`, ids 10 and 11. Resolves to 10.

Update `OtgHistoricCsv_ParseAndBuildRow_LandsEveryMappedFieldCorrectly` to seed the client codes it uses, or it will start rejecting rows.

## 4. Rollout

- **Staging (otgcargo):** already patched by Kerran's SQL on 8 Oct. No re-import needed. After this change deploys, upload one small CSV with a deliberately unknown client code and confirm it is rejected with the new message, and a known code lands with `clientId` populated in the batch drill-down.
- **Live (otgcargo):** do not load OTG history on Live until this is deployed. The cleaned OTG files are 5 CSVs of 5,000 rows in Steve's `Downloads\otg-historic-archive`; part01 first, then check the drill-down, then the rest.
- Other tenants: any `SourceID = 900` rows loaded before this fix on any tenant have `ucjbClientID = NULL` and need the same trigger-off SQL patch Kerran ran. Check with:

```sql
SELECT TenantDb = DB_NAME(), COUNT(*) AS NullClientRows
FROM tucJobArchive WHERE SourceID = 900 AND ucjbClientID IS NULL;
```

## 5. Acceptance

- Upload where every client code exists: `insertedCount = rowCount`, every row in `GET /api/historic-archive/batches/{id}/jobs` has non-null `clientId`.
- Upload with an unknown code: those rows rejected with a message naming the code; the rest inserted; batch detail shows the errors after the wizard is closed.
- Explicit `ClientId` column still bypasses the lookup.
- No change to the billing-sentinel recipe (`ucjbInvoiceNo`, `InvoiceProcessID`, `JournalHeaderID = 999999`, `ucjbChargeType = 0`, `SourceID = 900`).

## 6. Out of scope (separate decisions, Steve owns)

- **Accounts visibility.** Even with `ucjbClientID` set, the Accounts revenue report excludes these rows because it requires `ChargeType IN (2, 3)` and the import stamps `0` by design. Whether historic rows get a separate "invoiced externally" bucket in Accounts is a product decision, not part of this fix.
- **Courier resolution.** `DriverNo` style columns still map to `CourierId` by alias and are written as-is. OTG's driver numbers are not DFRNT `uccrID`s. The cleaned OTG files sidestep this by putting the driver number in `TextRef1`.
- **Preview-time validation.** Showing unresolved client codes on the Map step before commit would be nicer UX. Not needed for the OTG load; the error CSV covers it.
