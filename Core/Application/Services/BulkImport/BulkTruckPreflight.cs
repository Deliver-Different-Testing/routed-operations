// Read-only batch query for truck bulk insert rows. Writes nothing: the only
// inserts are into table variables local to the batch. The rate comes from the
// existing SQL function, called once per row, so bulk prices cannot drift from
// the booking page (findings section G).
using System.Text.Json;
using Dapper;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.BulkImport;

public interface IBulkTruckPreflight
{
    Task<IReadOnlyDictionary<int, TruckClientFacts>> LoadClientsAsync(IReadOnlyCollection<int> clientIds);
    Task<IReadOnlyList<TruckPreflightRow>> RunAsync(IReadOnlyList<TruckRowPlan> plans);

    /// <summary>
    /// What the booking page lists for a customer: the rate function's
    /// PublicDescription, by row. Only the customer preview asks for it.
    /// </summary>
    Task<IReadOnlyDictionary<int, string?>> PublicDescriptionsAsync(IReadOnlyList<TruckPublicRateRow> rows);
}

/// <summary>The rate function's inputs for a row the preflight has already resolved.</summary>
public sealed record TruckPublicRateRow(
    int RowNo, int ClientId, int FromId, int ToId, int Speed, decimal TotalWeight, int Qty, int Pickup, int Dropoff,
    DateTime BookDate, int OverSize, int OverWeight, bool PrivateRes, bool DG, DateTime? TruckStart, double? TruckHours);

public sealed class BulkTruckPreflight(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory), IBulkTruckPreflight
{
    private const int CommandTimeoutSeconds = 300;

    public const string ClientsSql = """
        SET NOCOUNT ON;
        SELECT c.ClientID AS ClientId,
               c.Code,
               c.TruckWeightLimit,
               CAST(CASE WHEN c.ucclGroupID IN (SELECT DISTINCT b.parentid FROM dbo.tucBaggageAirline b) THEN 1 ELSE 0 END AS bit) AS IsBaggage,
               CAST(ISNULL(c.ReferenceAMandatory, 0) AS bit) AS ReferenceAMandatory,
               c.ReferenceAMessage,
               CAST(ISNULL(c.ReferenceBMandatory, 0) AS bit) AS ReferenceBMandatory,
               c.ReferenceBMessage
        FROM dbo.tblClient c
        WHERE c.ClientID IN (SELECT [value] FROM OPENJSON(@ids) WITH ([value] int '$'));
        """;

    // Statement order follows WS_stpJob_Insert: name + postcode to suburb, retry
    // with Saint/Mount/Point, geo override, then site, then the same suburb ids
    // go to the after-hours lookups and the rate. UTL_fncJob_DesiredSpeed and
    // DirectSpeed declare @JobNumber and @PrebookJob without using them, so one
    // call per distinct route is safe. They cost about 156 ms each.
    public const string RowsSql = """
        SET NOCOUNT ON;

        DECLARE @UnknownSuburbID int = (SELECT TOP 1 SuburbID FROM dbo.tblSuburb WHERE [Name] = N'Unknown');
        DECLARE @RelationshipSingle int = (SELECT TOP 1 JobRelationshipTypeID FROM dbo.tblJobRelationshipType WHERE SystemName = N'Single');
        DECLARE @AfterHoursStatus int = (SELECT TOP 1 ucjsID FROM dbo.tucJobStatus WHERE ucjsName = 'After Hours');
        DECLARE @BookingStaff int = (SELECT TOP 1 ucstID FROM dbo.tucStaff WHERE ucstFirstName = 'Booking' AND ucstLastName = 'STP');
        DECLARE @DeliveryNoteType int = (SELECT TOP 1 NoteTypeId FROM dbo.tucNoteType WHERE NoteTypeName = 'Delivery Notes');
        DECLARE @PickupNoteType int = (SELECT TOP 1 NoteTypeId FROM dbo.tucNoteType WHERE NoteTypeName = 'Pickup Notes');

        DECLARE @r TABLE (
            RowNo int PRIMARY KEY, ClientId int, SpeedId int, JobNumber nvarchar(50), FromContact nvarchar(100),
            ClientRefA nvarchar(100), ClientRefB nvarchar(100),
            FromSuburb nvarchar(50), FromPostCode int, FromLat decimal(18,9), FromLng decimal(18,9),
            ToSuburb nvarchar(50), ToPostCode int, ToLat decimal(18,9), ToLng decimal(18,9),
            BookDate datetime, Qty int, TotalWeight decimal(18,4), Pickup int, Dropoff int, OverSize int, OverWeight int,
            PrivateRes bit, DG bit, TruckStart datetime, TruckHours float,
            PickupTimeZone nvarchar(100), DeliverByTimeZone nvarchar(100),
            FromId int, ToId int, FromSite int, ToSite int, EffectiveSpeed int);

        INSERT INTO @r (RowNo, ClientId, SpeedId, JobNumber, FromContact, ClientRefA, ClientRefB,
            FromSuburb, FromPostCode, FromLat, FromLng, ToSuburb, ToPostCode, ToLat, ToLng,
            BookDate, Qty, TotalWeight, Pickup, Dropoff, OverSize, OverWeight, PrivateRes, DG, TruckStart, TruckHours,
            PickupTimeZone, DeliverByTimeZone)
        SELECT j.RowNo, j.ClientId, j.SpeedId, j.JobNumber, j.FromContact, j.ClientRefA, j.ClientRefB,
            j.FromSuburb, j.FromPostCode, TRY_CONVERT(decimal(18,9), j.FromLat), TRY_CONVERT(decimal(18,9), j.FromLng),
            j.ToSuburb, j.ToPostCode, TRY_CONVERT(decimal(18,9), j.ToLat), TRY_CONVERT(decimal(18,9), j.ToLng),
            j.BookDate, j.Qty, j.TotalWeight, j.Pickup, j.Dropoff, j.OverSize, j.OverWeight, j.PrivateRes, j.DG, j.TruckStart, j.TruckHours,
            j.PickupTimeZone, j.DeliverByTimeZone
        FROM OPENJSON(@rows) WITH (
            RowNo int, ClientId int, SpeedId int, JobNumber nvarchar(50), FromContact nvarchar(100),
            ClientRefA nvarchar(100), ClientRefB nvarchar(100),
            FromSuburb nvarchar(50), FromPostCode int, FromLat nvarchar(50), FromLng nvarchar(50),
            ToSuburb nvarchar(50), ToPostCode int, ToLat nvarchar(50), ToLng nvarchar(50),
            BookDate datetime, Qty int, TotalWeight decimal(18,4), Pickup int, Dropoff int, OverSize int, OverWeight int,
            PrivateRes bit, DG bit, TruckStart datetime, TruckHours float,
            PickupTimeZone nvarchar(100), DeliverByTimeZone nvarchar(100)) j;

        UPDATE @r SET
            FromId = dbo.UTL_fncSuburb_FromNameWithPostCode(FromSuburb, NULL, FromPostCode),
            ToId = dbo.UTL_fncSuburb_FromNameWithPostCode(ToSuburb, NULL, ToPostCode);

        UPDATE @r SET FromId = dbo.UTL_fncSuburb_FromNameWithPostCode(
                REPLACE(REPLACE(REPLACE(FromSuburb, 'Saint', 'St'), 'Mount', 'Mt'), 'Point', 'Pt'), NULL, FromPostCode)
        WHERE FromId = 152;
        UPDATE @r SET ToId = dbo.UTL_fncSuburb_FromNameWithPostCode(
                REPLACE(REPLACE(REPLACE(ToSuburb, 'Saint', 'St'), 'Mount', 'Mt'), 'Point', 'Pt'), NULL, ToPostCode)
        WHERE ToId = 152;

        UPDATE @r SET FromId = COALESCE(dbo.UTL_fncSuburb_FromLocation(FromLng, FromLat), FromId)
        WHERE FromLat IS NOT NULL AND FromLng IS NOT NULL;
        UPDATE @r SET ToId = COALESCE(dbo.UTL_fncSuburb_FromLocation(ToLng, ToLat), ToId)
        WHERE ToLat IS NOT NULL AND ToLng IS NOT NULL;

        UPDATE @r SET FromId = ISNULL(FromId, @UnknownSuburbID), ToId = ISNULL(ToId, @UnknownSuburbID);

        UPDATE r SET
            FromSite = COALESCE(fp.SiteID, fsp.SiteID, fs.SiteID, 0),
            ToSite = COALESCE(tp.SiteID, tsp.SiteID, ts.SiteID, 0),
            -- UTL_stpJob_VariableModification. The six allowed truck speeds are
            -- all outside its exempt list, so a base region suburb means speed 10.
            EffectiveSpeed = CASE WHEN fs.ucsuBaseRegion = 1 OR ts.ucsuBaseRegion = 1 THEN 10 ELSE r.SpeedId END
        FROM @r r
        LEFT JOIN dbo.tblSuburb fs ON fs.SuburbID = r.FromId
        LEFT JOIN dbo.tblSuburb ts ON ts.SuburbID = r.ToId
        LEFT JOIN dbo.tucPostCode fsp ON fsp.PostCode = fs.PostCode
        LEFT JOIN dbo.tucPostCode tsp ON tsp.PostCode = ts.PostCode
        LEFT JOIN dbo.tucPostCode fp ON r.FromPostCode > 0 AND fp.PostCode = r.FromPostCode
        LEFT JOIN dbo.tucPostCode tp ON r.ToPostCode > 0 AND tp.PostCode = r.ToPostCode;

        DECLARE @routes TABLE (FromId int, ToId int, ClientId int, Speed int, Desired int, Direct bit,
            PRIMARY KEY (FromId, ToId, ClientId, Speed));
        INSERT INTO @routes (FromId, ToId, ClientId, Speed)
        SELECT DISTINCT FromId, ToId, ClientId, EffectiveSpeed FROM @r;
        UPDATE @routes SET
            Desired = dbo.UTL_fncJob_DesiredSpeed(FromId, ToId, ClientId, 4, Speed, NULL, 0),
            Direct = dbo.UTL_fncJob_DirectSpeed(FromId, ToId, ClientId, 4, Speed, NULL, 0);

        SELECT r.RowNo,
            r.FromId AS FromSuburbId,
            r.ToId AS ToSuburbId,
            CAST(CASE WHEN r.FromId = @UnknownSuburbID THEN 1 ELSE 0 END AS bit) AS FromUnknown,
            CAST(CASE WHEN r.ToId = @UnknownSuburbID THEN 1 ELSE 0 END AS bit) AS ToUnknown,
            fs.ucsuName AS FromSuburbName, fs.City AS FromCity, CONVERT(nvarchar(10), fs.PostCode) AS FromPostCode,
            ts.ucsuName AS ToSuburbName, ts.City AS ToCity, CONVERT(nvarchar(10), ts.PostCode) AS ToPostCode,
            CAST(CASE WHEN r.FromSite = r.ToSite THEN 1 ELSE 0 END AS bit) AS IsLocal,
            r.EffectiveSpeed AS EffectiveSpeedId,
            CAST(CASE WHEN ah.CanBook = 0 OR hol.CanBook = 0 THEN 0 ELSE 1 END AS bit) AS CanBook,
            CASE WHEN ah.CanBook = 0 THEN ah.[Message] WHEN hol.CanBook = 0 THEN hol.[Message] END AS OutOfHoursMessage,
            CONVERT(decimal(19,4), ISNULL(hol.Amount, ah.Amount)) AS AfterHoursAmount,
            ISNULL(hol.CourierID, ah.CourierID) AS AfterHoursCourierId,
            auto.CourierID AS AutoDespatchCourierId,
            CONVERT(decimal(19,4), CONVERT(money, rate.Rate)) AS Rate,
            CONVERT(decimal(19,4), dbo.UTL_fncFuelSurcharge_ExclusiveAmount(r.ClientId, CONVERT(date, r.BookDate), 4, CONVERT(money, rate.Rate), r.FromId, r.ToId, r.EffectiveSpeed)) AS Fuel,
            rt.Desired AS DesiredJobTypeId,
            ISNULL(rt.Direct, 0) AS Direct,
            CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.tucJob x WHERE x.ucjbNumber = r.JobNumber) THEN 1 ELSE 0 END AS bit) AS JobNumberExists,
            CAST(CASE WHEN c.ReferenceADefineList = 1 AND NOT EXISTS (SELECT 1 FROM dbo.tblReference ra WHERE ra.ClientID = r.ClientId AND ra.[Name] = r.ClientRefA AND ra.[Grouping] = 'A') THEN 0 ELSE 1 END AS bit) AS ReferenceAInList,
            CAST(CASE WHEN c.ReferenceBDefineList = 1 AND NOT EXISTS (SELECT 1 FROM dbo.tblReference rb WHERE rb.ClientID = r.ClientId AND rb.[Name] = r.ClientRefB AND rb.[Grouping] = 'B') THEN 0 ELSE 1 END AS bit) AS ReferenceBInList,
            ct.ContactID AS ContactId,
            ptz.Id AS PickupTimeZoneId,
            dtz.Id AS DeliverByTimeZoneId,
            @RelationshipSingle AS JobRelationshipTypeId,
            @AfterHoursStatus AS AfterHoursStatusId,
            @BookingStaff AS BookingStaffId,
            @DeliveryNoteType AS DeliveryNoteTypeId,
            @PickupNoteType AS PickupNoteTypeId,
            GETDATE() AS ServerNow
        FROM @r r
        INNER JOIN dbo.tblClient c ON c.ClientID = r.ClientId
        LEFT JOIN dbo.tucSuburb fs ON fs.ucsuID = r.FromId
        LEFT JOIN dbo.tucSuburb ts ON ts.ucsuID = r.ToId
        LEFT JOIN @routes rt ON rt.FromId = r.FromId AND rt.ToId = r.ToId AND rt.ClientId = r.ClientId AND rt.Speed = r.EffectiveSpeed
        LEFT JOIN dbo.[TimeZone] ptz ON ptz.[DisplayName] = r.PickupTimeZone
        LEFT JOIN dbo.[TimeZone] dtz ON dtz.[DisplayName] = r.DeliverByTimeZone
        OUTER APPLY (
            SELECT TOP 1 a.CanBook, a.Amount, a.CourierID, a.[Message]
            FROM dbo.tblAfterHours a
            WHERE a.SiteID = c.SiteID
              AND (a.ClientID = r.ClientId OR a.ClientID IS NULL)
              AND (a.SpeedID = r.SpeedId OR a.SpeedID IS NULL OR a.AllSpeeds = 1)
              AND a.JobEntryType = 'Local' AND a.Active = 1
              AND CONVERT(nvarchar(50), r.BookDate, 108) BETWEEN CONVERT(nvarchar(50), a.StartTime, 108) AND CONVERT(nvarchar(50), a.EndTime, 108)
              AND (DATENAME(dw, r.BookDate) = a.[DayName] OR a.EveryDay = 1)
            ORDER BY a.CanBook DESC) ah
        OUTER APPLY (
            SELECT TOP 1 h.CanBook, h.Amount, h.CourierID, h.[Message]
            FROM dbo.tblHoliday h
            WHERE h.SiteID = c.SiteID
              AND (h.ClientID = r.ClientId OR h.ClientID IS NULL)
              AND (h.SpeedID = r.SpeedId OR h.SpeedID IS NULL OR h.AllSpeeds = 1)
              AND CONVERT(nvarchar(50), h.[Date], 106) = CONVERT(nvarchar(50), r.BookDate, 106)
              AND CONVERT(nvarchar(50), r.BookDate, 108) BETWEEN CONVERT(nvarchar(50), h.StartTime, 108) AND CONVERT(nvarchar(50), h.EndTime, 108)
              AND h.JobEntryType = 'Local'
            ORDER BY h.CanBook DESC) hol
        OUTER APPLY (
            -- UTL_stpJob_Modification: same site only, unknown suburbs excluded.
            SELECT TOP 1 d.CourierID
            FROM dbo.tblSuburb sf
            INNER JOIN dbo.tblSuburb st ON st.SuburbID = r.ToId AND st.SiteID = sf.SiteID
            INNER JOIN dbo.tblAutoDespatch d ON d.SiteID = sf.SiteID AND (d.ClientID = r.ClientId OR d.ClientID IS NULL)
            WHERE sf.SuburbID = r.FromId AND r.FromId <> @UnknownSuburbID AND r.ToId <> @UnknownSuburbID
            ORDER BY d.ClientID DESC) auto
        OUTER APPLY (
            SELECT TOP 1 tc.ContactID
            FROM dbo.tblContact tc
            INNER JOIN dbo.tblClientContact cc ON cc.ContactID = tc.ContactID
            WHERE (tc.FirstName + N' ' + tc.Surname) = r.FromContact AND cc.ClientID = r.ClientId AND tc.Active = 1
            ORDER BY tc.ContactID DESC) ct
        OUTER APPLY dbo.UTL_fncJob_Truck_RateAndDescription(
            r.ClientId, r.FromId, r.ToId, r.EffectiveSpeed, 4, r.TotalWeight, GETDATE(), 0, r.Qty, r.Pickup, r.Dropoff,
            r.BookDate, r.OverSize, r.OverWeight, r.PrivateRes, r.DG, r.TruckStart, r.TruckHours, 1) rate
        ORDER BY r.RowNo;
        """;

    // NET_stpJob_Truck_Rate_Described, the booking page's call: fuel included in
    // each line (1) and the book date as @Date. RowsSql asks with fuel excluded,
    // so its text is not what the page shows, and this is a separate call.
    public const string PublicDescriptionsSql = """
        SET NOCOUNT ON;
        SELECT j.RowNo, rate.PublicDescription
        FROM OPENJSON(@rows) WITH (
            RowNo int, ClientId int, FromId int, ToId int, Speed int, TotalWeight decimal(18,4), Qty int, Pickup int, Dropoff int,
            BookDate datetime, OverSize int, OverWeight int, PrivateRes bit, DG bit, TruckStart datetime, TruckHours float) j
        OUTER APPLY dbo.UTL_fncJob_Truck_RateAndDescription(
            j.ClientId, j.FromId, j.ToId, j.Speed, 4, j.TotalWeight, j.BookDate, 1, j.Qty, j.Pickup, j.Dropoff,
            j.BookDate, j.OverSize, j.OverWeight, j.PrivateRes, j.DG, j.TruckStart, j.TruckHours, 1) rate;
        """;

    public async Task<IReadOnlyDictionary<int, TruckClientFacts>> LoadClientsAsync(IReadOnlyCollection<int> clientIds)
    {
        var rows = await Context.Database.GetDbConnection().QueryAsync<TruckClientFactsRow>(
            ClientsSql, new { ids = JsonSerializer.Serialize(clientIds) }, commandTimeout: CommandTimeoutSeconds);
        return rows.ToDictionary(r => r.ClientId, r => new TruckClientFacts(
            r.ClientId, r.Code ?? "", r.TruckWeightLimit, r.IsBaggage,
            r.ReferenceAMandatory, r.ReferenceAMessage, r.ReferenceBMandatory, r.ReferenceBMessage));
    }

    public async Task<IReadOnlyList<TruckPreflightRow>> RunAsync(IReadOnlyList<TruckRowPlan> plans)
    {
        if (plans.Count == 0) return Array.Empty<TruckPreflightRow>();
        var rows = await Context.Database.GetDbConnection().QueryAsync<TruckPreflightRow>(
            RowsSql, new { rows = BuildRowsJson(plans) }, commandTimeout: CommandTimeoutSeconds);
        return rows.ToList();
    }

    public async Task<IReadOnlyDictionary<int, string?>> PublicDescriptionsAsync(IReadOnlyList<TruckPublicRateRow> rows)
    {
        if (rows.Count == 0) return new Dictionary<int, string?>();
        var found = await Context.Database.GetDbConnection().QueryAsync<TruckPublicDescriptionRow>(
            PublicDescriptionsSql, new { rows = JsonSerializer.Serialize(rows, TruckJson.Options) }, commandTimeout: CommandTimeoutSeconds);
        return found.ToDictionary(r => r.RowNo, r => r.PublicDescription);
    }

    public static string BuildRowsJson(IReadOnlyList<TruckRowPlan> plans) =>
        JsonSerializer.Serialize(plans.Select(p =>
        {
            var j = p.Input.Job;
            return new
            {
                RowNo = p.Input.RowNo,
                ClientId = p.Input.ClientId,
                SpeedId = p.Input.SpeedId,
                JobNumber = j.JobNumber?.Trim(),
                FromContact = j.FromContact?.Trim(),
                ClientRefA = j.ClientRefA,
                ClientRefB = j.ClientRefB,
                FromSuburb = j.FromSuburb?.Trim(),
                FromPostCode = ToInt(j.FromPostCode),
                FromLat = j.FromLatitude,
                FromLng = j.FromLongitude,
                ToSuburb = j.ToSuburb?.Trim(),
                ToPostCode = ToInt(j.ToPostCode),
                ToLat = j.ToLatitude,
                ToLng = j.ToLongitude,
                BookDate = p.Input.BookDateTime,
                Qty = (int)p.Quantity,
                // @AverageWeight on the rate function takes the TOTAL weight, as
                // WS_stpJob_Insert passes it.
                TotalWeight = p.TotalWeight,
                Pickup = p.TailLiftPickupCount,
                Dropoff = p.TailLiftDropoffCount,
                OverSize = p.OverSizeItems,
                OverWeight = p.OverWeightItems,
                PrivateRes = p.Residential,
                DG = p.DangerousGoods,
                TruckStart = p.TruckStart,
                TruckHours = p.TruckHours,
                PickupTimeZone = p.Input.PickupTimeZone,
                DeliverByTimeZone = p.Input.DeliverByTimeZone,
            };
        }), TruckJson.Options);

    private static int? ToInt(string? value) => int.TryParse(value?.Trim(), out var n) ? n : null;

    private sealed class TruckPublicDescriptionRow
    {
        public int RowNo { get; set; }
        public string? PublicDescription { get; set; }
    }

    private sealed class TruckClientFactsRow
    {
        public int ClientId { get; set; }
        public string? Code { get; set; }
        public int? TruckWeightLimit { get; set; }
        public bool IsBaggage { get; set; }
        public bool ReferenceAMandatory { get; set; }
        public string? ReferenceAMessage { get; set; }
        public bool ReferenceBMandatory { get; set; }
        public string? ReferenceBMessage { get; set; }
    }
}
