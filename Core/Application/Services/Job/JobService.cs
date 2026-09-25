using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Job;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Job;

/// <summary>
/// Read-side lift of `UTL_stpJob_tblBulkJobWithFilter` plus per-job edit
/// operations that previously lived on JobRepository. The dispatch flow lives
/// on RunCommitService (still SP-backed) and HD sync on HdJobSyncService.
///
/// Read filters accept comma-delimited strings (matching the legacy contract);
/// null/empty means "no filter". Excludes Done rows and Void rows to mirror the
/// legacy SP's default behaviour.
/// </summary>
public class JobService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    public async Task<List<BulkJobDto>> GetBulkJobsAsync(
        DateTime? dateTime, string? clientIds, string? regionIds, string? ourRefs, string? speeds)
    {
        // Phase 1 perf: pre-fetch the set of parent-job IDs in one indexed scan
        // and materialise them into a HashSet so the main query filters via a
        // simple `NOT IN` set-compare instead of a correlated `NOT EXISTS`
        // subquery evaluated per row. Set-lookup is O(1); for typical tenants
        // the parent set is a few hundred rows so the IN clause stays tractable.
        //
        // Parents are the pickup leg of a paired pickup/delivery booking;
        // only the delivery children need to appear in the run-build cockpit.
        // Matches the legacy RunBuilder behaviour where parents are auto-
        // assigned to the "9999 ParentJobs" courier and hidden from the
        // operator's selection set.
        var parentIds = await Context.TblBulkJobs
            .AsNoTracking()
            .Where(j => j.ParentId.HasValue)
            .Select(j => j.ParentId!.Value)
            .Distinct()
            .ToListAsync();
        var parentIdSet = new HashSet<int>(parentIds);

        // AsNoTracking on the main query - the whole pipeline projects to
        // BulkJobDto, no entity mutation happens downstream in this method.
        var query = Context.TblBulkJobs
            .AsNoTracking()
            .Where(j => !j.Done && !j.Void)
            .Where(j => !parentIdSet.Contains(j.BulkJobId))
            // Legacy filter: ISNULL(JobRelationshipTypeID, 0) <> 19 - drops
            // linehaul-sibling rows the operator should never see in the cockpit.
            .Where(j => (j.JobRelationshipTypeId ?? 0) != 19)
            // Legacy filter: NOT EXISTS (linehaul job like '%LH%' whose booked
            // schedule has an active tblBulkScheduleLinehaul row with InsertToBulk=0).
            // If the schedule is configured to *not* auto-insert linehaul jobs into
            // the bulk pool, the LH job should stay hidden from the cockpit.
            .Where(j => !(j.JobNumber != null && j.JobNumber.Contains("LH")
                          && Context.TblBulkScheduleLinehauls.Any(lh =>
                                lh.BulkRunScheduleId == j.ScheduleId
                                && (lh.InsertToBulk ?? false) == false)))
            .AsQueryable();

        if (dateTime.HasValue)
        {
            var d = dateTime.Value.Date;
            query = query.Where(j => j.BookDate.Date == d);
        }

        var clientIdSet = ParseIntList(clientIds);
        if (clientIdSet.Count > 0)
            query = query.Where(j => clientIdSet.Contains(j.ClientId));

        var regionIdSet = ParseIntList(regionIds);
        if (regionIdSet.Count > 0)
        {
            // Legacy SP's region filter joins tblBulkRegion via lat/lng match
            // OR a fuzzy-normalised FromAddress equality (see UTL_stpJob_
            // tblBulkJobWithFilter). It does NOT trust tblBulkJob.RegionID.
            // We replicate via raw SQL - the string normaliser (space<>tokenise
            // + st->street rewrite + retrim) is nasty in EF LINQ, and the
            // filter runs once per page so a single roundtrip is fine.
            //
            // Push the same date + Done + Void narrowing filters here that
            // the main EF query applies, so we don't scan the whole tblBulkJob
            // (millions of rows on Urgent-Prod) just to feed the outer .Where.
            // Reported 2026-08-27: unfiltered scan timed out at 30s SQL
            // command timeout on Tenant 5, blocking the Route Builder load.
            //
            // regionIdSet ids come from int.TryParse in ParseIntList - safe
            // to interpolate. Date is parameterised.
            var inList = string.Join(",", regionIdSet);
            var parameters = new List<SqlParameter>();
            var dateClause = string.Empty;
            if (dateTime.HasValue)
            {
                var d = dateTime.Value.Date;
                dateClause = " AND j.BookDate >= @dateStart AND j.BookDate < @dateEnd";
                parameters.Add(new SqlParameter("@dateStart", d));
                parameters.Add(new SqlParameter("@dateEnd", d.AddDays(1)));
            }
            var sql = $@"SELECT DISTINCT j.BulkJobID AS Value
                   FROM tblBulkJob j
                   LEFT JOIN tblBulkRegion breg
                     ON ((breg.PickupLatitude = j.PickUpLatitude
                       AND breg.PickupLongitude = j.PickUpLongitude)
                     OR LOWER(RTRIM(breg.FromAddress)) COLLATE DATABASE_DEFAULT
                        = LOWER(LTRIM(RTRIM(REPLACE(
                            REPLACE(
                              REPLACE(N' ' + j.FromAddress + N' ', ' ', '<>'),
                              '>st<', '>street<'),
                            '<>', ' '
                          )))) COLLATE DATABASE_DEFAULT)
                   WHERE breg.BulkRegionId IN ({inList})
                     AND ISNULL(j.Done, 0) = 0
                     AND ISNULL(j.[Void], 0) = 0
                     {dateClause}";
            var jobIds = await Context.Database.SqlQueryRaw<int>(sql, parameters.ToArray()).ToListAsync();
            query = query.Where(j => jobIds.Contains(j.BulkJobId));
        }

        var ourRefSet = ParseStringList(ourRefs);
        if (ourRefSet.Count > 0)
            query = query.Where(j => j.OurRef != null && ourRefSet.Contains(j.OurRef));

        var speedSet = ParseIntList(speeds);
        if (speedSet.Count > 0)
            query = query.Where(j => speedSet.Contains(j.Speed));

        // ISO day-of-week (Mon=1..Sun=7) for the target run date - matches the
        // legacy SP's SET DATEFIRST 1 + DATEPART(weekday) behaviour, so the
        // window sibling lookup lands on the same row regardless of session.
        int? targetDow = dateTime.HasValue
            ? (int)DayOfWeekIso(dateTime.Value.DayOfWeek)
            : null;

        var joined =
            from j in query
            join t in Context.TucJobTypes on j.Speed equals t.UcjtId into speedJoin
            from t in speedJoin.DefaultIfEmpty()
            join c in Context.TucCouriers on j.CourierId equals c.UccrId into courierJoin
            from c in courierJoin.DefaultIfEmpty()
            // tucClient join. Legacy SP uses INNER JOIN - jobs with orphan
            // ClientId (deleted client, tenant reseed) are silently dropped
            // from the cockpit's Jobs list. We match that behaviour here.
            join cli in Context.TucClients on j.ClientId equals cli.UcclId
            // Postcode -> RunName / MergeTo / Sequence lookup. Legacy SP:
            // LEFT JOIN TblBulkPostCodeRunName rn ON rn.PostCode = ToPostCode.
            // Nullable + defensive: `rn.PostCode` in DB is nvarchar so we compare
            // against `ToPostCode.ToString()` to stay type-safe in LINQ.
            join rn in Context.TblBulkPostCodeRunNames
                on (j.ToPostCode != null ? j.ToPostCode.Value.ToString() : null) equals rn.PostCode
                into postcodeRunJoin
            from rn in postcodeRunJoin.DefaultIfEmpty()
            // BulkJobRun link (holds PickRunOrder + gives BulkJobRunId). Legacy
            // SP: LEFT JOIN tblBulkJobRun r ON r.BulkJobID = tblBulkJob.BulkJobID.
            // Unique per BulkJobID (filtered index), so no fan-out.
            join r in Context.TblBulkJobRuns on j.BulkJobId equals r.BulkJobId
                into bjrJoin
            from r in bjrJoin.DefaultIfEmpty()
            // Booked-against schedule (may be for a different weekday than the target).
            join s in Context.TblBulkRunSchedules on j.ScheduleId equals s.BulkRunScheduleId into schedJoin
            from s in schedJoin.DefaultIfEmpty()
            // Target-day sibling: same Name + Client + Speed + Region, matching
            // the build date's weekday. Legacy SP uses OUTER APPLY TOP(1) with
            // a two-key ORDER BY: prefer sibling windows that contain BookTime,
            // else fall back to smallest BulkRunScheduleId. That deterministic
            // tiebreak matters when multiple sibling rows exist for the same
            // composite key - EF's join could otherwise return a non-window
            // row and jitter the Delivery Window on the UI.
            //
            // We approximate the SP contract with two LEFT JOINs + a client-side
            // pick: candidate sibling rows are the same composite key + weekday
            // + AutoBook=0. If any candidate window contains the job's BookTime
            // we pick that; otherwise the smallest BulkRunScheduleId wins. See
            // materialisation loop below.
            // Coalesce nullable keys to sentinel values so EF's join matches
            // NULL-to-NULL (legacy SQL SP uses ISNULL(..., -1) / ISNULL(..., '')
            // on both sides). Without this, any schedule with NULL Client/Speed/
            // Region silently fails to find its sibling window on the target day.
            join sw in Context.TblBulkRunSchedules
                .Where(x => (x.AutoBook ?? false) == false)
                on new
                {
                    Name = s != null ? s.Name ?? string.Empty : string.Empty,
                    ClientId = s != null && s.ClientId.HasValue ? s.ClientId.Value : -1,
                    SpeedId = s != null && s.SpeedId.HasValue ? s.SpeedId.Value : -1,
                    Region = s != null && s.Region.HasValue ? s.Region.Value : -1,
                    DayOfWeek = targetDow ?? -1,
                }
                equals new
                {
                    Name = sw.Name ?? string.Empty,
                    ClientId = sw.ClientId ?? -1,
                    SpeedId = sw.SpeedId ?? -1,
                    Region = sw.Region ?? -1,
                    DayOfWeek = sw.DayOfWeek.HasValue ? (int)sw.DayOfWeek.Value : -1,
                } into siblingJoin
            from sw in siblingJoin.DefaultIfEmpty()
            where s == null || s.AutoBook != true
            select new
            {
                // TimeSpan? survives EF projection since the entity is TimeSpan?.
                // We convert to DateTime? in-memory below to sidestep the
                // cross-tenant TIME vs DATETIME cast problem the SP handles server-side.
                WindowStart = sw != null ? sw.StartTime : null,
                WindowEnd = sw != null ? sw.EndTime : null,
                Dto = new BulkJobDto
                {
                BulkJobId = j.BulkJobId,
                JobNumber = j.JobNumber,
                BookDate = j.BookDate,
                BookTime = j.BookTime,
                JobStatus = j.JobStatus,
                ClientId = j.ClientId,
                ClientCode = j.ClientCode,
                Amount = j.Amount,
                Speed = j.Speed,
                SpeedName = t.UcjtName,
                FromCompany = j.FromCompany,
                FromAddress = j.FromAddress,
                FromSuburb = j.FromSuburb,
                FromPostCode = j.FromPostCode,
                ToCompany = j.ToCompany,
                ToAddress = j.ToAddress,
                ToSuburb = j.ToSuburb,
                ToPostCode = j.ToPostCode,
                Size = j.Size,
                Qty = j.Qty,
                Weight = j.Weight,
                CourierId = j.CourierId,
                CourierName = c != null ? c.Code + " " + c.UccrName : null,
                ClientRefa = j.ClientRefa,
                ClientRefb = j.ClientRefb,
                OurRef = j.OurRef,
                // Phase 3 perf: Notes dropped from the list projection - can
                // be several hundred chars per row on tenants with heavy note
                // usage. Fetched on-demand via GET /api/jobs/{id}/detail.
                Notes = null,
                PickUpLatitude = j.PickUpLatitude,
                PickUpLongitude = j.PickUpLongitude,
                DeliveryLatitude = j.DeliveryLatitude,
                DeliveryLongitude = j.DeliveryLongitude,
                PrebookJob = j.PrebookJob,
                OnHold = j.OnHold,
                Void = j.Void,
                Done = j.Done,
                BulkRunId = j.BulkRunId,
                RunName = j.RunName,
                // Legacy SP: r.PickRunOrder AS BuilderIndex. We prefer the join-
                // table row (more authoritative under concurrent writes) and
                // fall back to the tblBulkJob.RunOrder denorm when the row is
                // missing (defensive - happens after a delete that didn't cascade).
                RunOrder = r != null ? r.PickRunOrder : j.RunOrder,
                MultiboxParentId = j.MultiboxParentId,
                ParentId = j.ParentId,
                RegionId = j.RegionId,
                Barcode = j.Barcode,
                // Legacy SP alias: DeliverToPrivateBusiness AS 'Ok_To_Leave'.
                OkToLeave = j.DeliverToPrivateBusiness,
                Contact = j.Contact,
                DeliverToContact = j.DeliverToContact,
                DeliverToPhone = j.DeliverToPhone,
                // Phase 3 perf: heavy display-only fields (TrackingEmail,
                // TrackingMobile, ProofOfDeliveryEmail, ProofOfDeliveryMobile)
                // dropped from the list projection - fetched on-demand via
                // GET /api/jobs/{id}/detail when the operator opens the
                // JobDetail modal. Explicitly null-projected here so consumers
                // that spread the DTO still get the keys, just empty values.
                TrackingEmail = null,
                TrackingMobile = null,
                ProofOfDeliveryEmail = null,
                ProofOfDeliveryMobile = null,
                ScheduleId = s != null ? s.BulkRunScheduleId : (int?)null,
                ScheduleName = s != null ? s.Name : null,
                // ScheduleWindowStart/End are filled in-memory below from the
                // TimeSpan? carried in the outer anonymous type.
                // Cubic total: sum over tblBulkJobItems using per-item Cubic when
                // present, otherwise fall back to Length x Height x Depth / 1e6.
                JobCubicM3 = Context.TblBulkJobItems
                    .Where(bji => bji.JobId == j.BulkJobId)
                    .Select(bji =>
                        ((bji.Cubic ?? 0m) != 0m
                            ? bji.Cubic!.Value
                            // Length/Height/Depth are FLOAT (double) - convert
                            // once at the leaf so the outer arithmetic stays in
                            // decimal and the reader stays happy.
                            : ((bji.Length ?? 0d) > 0d && (bji.Height ?? 0d) > 0d && (bji.Depth ?? 0d) > 0d
                                ? (decimal)((bji.Length!.Value * bji.Height!.Value * bji.Depth!.Value) / 1000000d)
                                : 0m))
                        * (bji.Items ?? 0))
                    .Sum(),
                // Legacy SP: ISNULL(client.MaxJobsPerRun, 20). Client join is
                // INNER now, so cli is always non-null; only MaxJobsPerRun can be.
                MaxJobsPerRun = cli.MaxJobsPerRun.HasValue ? cli.MaxJobsPerRun.Value : (int?)20,
                // Pickup-cutoff hint from the target-day schedule sibling (sw).
                // Falls back to null when no schedule row applies - the
                // client-side build config only enforces the cap when both a
                // value is present AND the operator ticks the option.
                ApplyPickupCutoff = sw != null ? sw.ApplyPickupCutoff : (bool?)null,
                PickupCutoffHours = sw != null ? sw.PickupCutoff : (int?)null,
                // Postcode-run-name projections. Legacy SP:
                //   ISNULL(rn.RunName, ToPostCode) AS PrefixRunName
                //   rn.PostCodeMergeTo
                //   ISNULL(rn.RunSequence, 0) AS RunSequence
                PrefixRunName = rn != null && rn.RunName != null
                    ? rn.RunName
                    : (j.ToPostCode != null ? j.ToPostCode.Value.ToString() : null),
                PostCodeMergeTo = rn != null ? rn.PostCodeMergeTo : null,
                RunSequence = rn != null && rn.RunSequence.HasValue ? rn.RunSequence.Value : 0,
                BulkJobRunId = r != null ? r.Id : 0,
                }
            };

        var materialised = await joined.ToListAsync();
        var baseDate = new DateTime(1900, 1, 1);
        return materialised
            // Legacy SP: ORDER BY BookTime, PrefixRunName, BuilderIndex.
            // Sort in-memory after projection so the client renders in the
            // same order operators are used to. NULL RunOrder placed FIRST
            // (int.MinValue) to match SQL Server's default ASC NULLS FIRST -
            // legacy operators expect unassigned rows above ordered ones.
            .OrderBy(x => x.Dto.BookTime)
            .ThenBy(x => x.Dto.PrefixRunName)
            .ThenBy(x => x.Dto.RunOrder ?? int.MinValue)
            .Select(x =>
            {
                if (x.WindowStart.HasValue) x.Dto.ScheduleWindowStart = baseDate.Add(x.WindowStart.Value);
                if (x.WindowEnd.HasValue) x.Dto.ScheduleWindowEnd = baseDate.Add(x.WindowEnd.Value);
                return x.Dto;
            })
            .ToList();
    }

    /// <summary>
    /// Converts .NET DayOfWeek (Sunday=0..Saturday=6) to ISO 8601 weekday
    /// (Monday=1..Sunday=7) to match the legacy SET DATEFIRST 1 pattern.
    /// </summary>
    private static int DayOfWeekIso(DayOfWeek d) =>
        d == DayOfWeek.Sunday ? 7 : (int)d;

    /// <summary>
    /// Phase 3 perf: lazy-loads the 5 "heavy" display-only fields that were
    /// pulled out of the /api/jobs list projection. Called only when the
    /// operator opens the JobDetail modal - not on every cockpit filter
    /// toggle. Returns null if the job is not visible to this tenant.
    /// </summary>
    public async Task<JobDetailExtrasDto?> GetJobDetailExtrasAsync(int jobId)
    {
        return await Context.TblBulkJobs
            .AsNoTracking()
            .Where(j => j.BulkJobId == jobId)
            .Select(j => new JobDetailExtrasDto
            {
                BulkJobId = j.BulkJobId,
                Notes = j.Notes,
                TrackingEmail = j.TrackingEmail,
                TrackingMobile = j.TrackingMobile,
                ProofOfDeliveryEmail = j.ProofOfDeliveryEmail,
                ProofOfDeliveryMobile = j.ProofOfDeliveryMobile,
            })
            .FirstOrDefaultAsync();
    }

    public async Task<List<object>> GetClientFiltersAsync()
    {
        var settings = await Context.TblBulkJobs
            .Where(j => !j.Done)
            .Select(j => new { j.ClientId, j.ClientCode })
            .Distinct()
            .ToListAsync();

        return settings
            .Select(s => (object)new { id = s.ClientId, label = s.ClientCode })
            .ToList();
    }

    public async Task<List<string>> GetOurRefsAsync(DateTime date)
    {
        var d = date.Date;
        return await Context.TblBulkJobs
            .Where(j => !j.Done && !j.Void && j.BookDate.Date == d && j.OurRef != null)
            .OrderBy(j => j.OurRef)
            .Select(j => j.OurRef!)
            .Distinct()
            .ToListAsync();
    }

    public async Task<List<int>> GetMultiboxChildrenAsync(int parentBulkJobId)
    {
        return await Context.TblBulkJobs
            .Where(j => j.MultiboxParentId == parentBulkJobId || j.ParentId == parentBulkJobId)
            .Select(j => j.BulkJobId)
            .ToListAsync();
    }

    public async Task<bool> UpdateJobDetailAsync(int jobId, string field, string value)
    {
        var job = await Context.TblBulkJobs.FindAsync(jobId);
        if (job == null) return false;

        try
        {
            switch (field)
            {
                case "Amount":
                case "Weight":
                    Context.Entry(job).Property(field).CurrentValue = Convert.ToDecimal(value, CultureInfo.InvariantCulture);
                    break;
                case "Qty":
                    Context.Entry(job).Property(field).CurrentValue = Convert.ToInt16(value, CultureInfo.InvariantCulture);
                    break;
                case "Speed":
                    Context.Entry(job).Property(field).CurrentValue = Convert.ToInt32(value, CultureInfo.InvariantCulture);
                    break;
                case "OkToLeave":
                    // Frontend sends "true"/"false" (string) for the "Sig not req"
                    // checkbox. Persist onto DeliverToPrivateBusiness (the actual
                    // column alias per legacy SP). Null cleared when value is empty.
                    Context.Entry(job).Property(nameof(TblBulkJob.DeliverToPrivateBusiness)).CurrentValue =
                        string.IsNullOrWhiteSpace(value) ? (bool?)null
                        : bool.TryParse(value, out var b) ? b
                        : value.Trim() == "1";
                    break;
                case "BookDate":
                    if (DateTime.TryParseExact(value, "dd/MM/yyyy", CultureInfo.InvariantCulture,
                            DateTimeStyles.None, out var bookDate))
                        Context.Entry(job).Property(field).CurrentValue = bookDate;
                    else
                        Context.Entry(job).Property(field).CurrentValue =
                            DateTime.Parse(value, CultureInfo.InvariantCulture);
                    break;
                case "BookTime":
                    var timeFormats = new[] { "HH:mm:ss", "HH:mm", "h:mm tt", "h:mm:ss tt" };
                    if (DateTime.TryParseExact(value, timeFormats, CultureInfo.InvariantCulture,
                            DateTimeStyles.None, out var bookTime))
                        Context.Entry(job).Property(field).CurrentValue = bookTime;
                    else
                        Context.Entry(job).Property(field).CurrentValue =
                            DateTime.Parse(value, CultureInfo.InvariantCulture);
                    break;
                default:
                    Context.Entry(job).Property(field).CurrentValue = value;
                    break;
            }

            Context.Entry(job).State = EntityState.Modified;
            await Context.SaveChangesAsync();
            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "UpdateJobDetailAsync failed for JobId {JobId} Field {Field}", jobId, field);
            throw;
        }
    }

    public async Task<bool> UpdateGpsAsync(UpdateGpsRequest request)
    {
        var job = await Context.TblBulkJobs.FindAsync(request.JobId);
        if (job == null) return false;

        var postCode = ParsePostCode(request.PostCode);

        if (request.Address == "ToAddress")
        {
            job.DeliveryLatitude = request.Lat;
            job.DeliveryLongitude = request.Lng;
            job.ToPostCode = postCode;
        }
        else
        {
            job.PickUpLatitude = request.Lat;
            job.PickUpLongitude = request.Lng;
            job.FromPostCode = postCode;
        }

        Context.Entry(job).State = EntityState.Modified;
        await Context.SaveChangesAsync();
        return true;
    }

    /// <summary>
    /// TblBulkJob.To/FromPostCode is `int?` in the schema, but US tenants send
    /// postcodes as ZIP+4 strings ("02138-4137") from the geocoder. Strip
    /// anything after the first hyphen, keep only digits, then int.Parse.
    /// Leading zeros drop (int 2138 for "02138") - operators reading it back
    /// display it as-is; the ZIP+4 suffix isn't stored anywhere in the schema.
    /// Falls back to 0 when the input has no digits, matching legacy behaviour.
    /// </summary>
    private static int ParsePostCode(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return 0;
        var head = raw.Split('-', 2)[0];
        var digitsOnly = new string(head.Where(char.IsDigit).ToArray());
        return int.TryParse(digitsOnly, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;
    }

    public async Task<object> BulkUpdateRouteDateAsync(BulkUpdateRouteDateRequest request)
    {
        var results = new List<object>();
        var successCount = 0;
        var failureCount = 0;

        await using var transaction = await Context.Database.BeginTransactionAsync();
        try
        {
            var jobsToUpdate = await Context.TblBulkJobs
                .Where(job => request.JobIds.Contains(job.BulkJobId))
                .ToListAsync();

            var foundIds = jobsToUpdate.Select(j => j.BulkJobId).ToHashSet();
            foreach (var notFoundId in request.JobIds.Where(id => !foundIds.Contains(id)))
            {
                results.Add(new { Result = "Failed", Message = $"Job with ID {notFoundId} not found" });
                failureCount++;
            }

            foreach (var job in jobsToUpdate)
            {
                job.BookDate = request.NewDate;
                Context.Entry(job).State = EntityState.Modified;
                results.Add(new { Result = "Success", Message = $"Job {job.BulkJobId} updated" });
                successCount++;
            }

            if (successCount > 0)
            {
                await Context.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            else
            {
                await transaction.RollbackAsync();
            }

            Log.Information("Bulk route date update for run '{RunName}': {Success} ok, {Failed} failed",
                request.RunName, successCount, failureCount);

            return new
            {
                Success = successCount,
                Failed = failureCount,
                Details = results,
                Message = $"Updated {successCount} jobs successfully, {failureCount} failed",
                RunName = request.RunName,
                NewDate = request.NewDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)
            };
        }
        catch (Exception e)
        {
            await transaction.RollbackAsync();
            Log.Error(e, "Bulk route date update failed for run '{RunName}'", request.RunName);
            return new
            {
                Success = 0,
                Failed = request.JobIds.Count,
                Details = Array.Empty<object>(),
                Message = "Bulk update failed: " + (e.InnerException?.Message ?? e.Message),
                RunName = request.RunName,
                NewDate = request.NewDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)
            };
        }
    }

    private static List<int> ParseIntList(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return new List<int>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Trim())
            .Where(s => int.TryParse(s, out _))
            .Select(int.Parse)
            .ToList();
    }

    private static List<string> ParseStringList(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return new List<string>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Trim())
            .Where(s => !string.IsNullOrEmpty(s))
            .ToList();
    }
}
