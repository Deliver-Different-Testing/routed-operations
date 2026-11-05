// Pure C# half of the truck bulk insert (card bulk-insert-truck-and-ai, Part A).
// No DB access, so every rule here is unit tested in TruckRowCalculatorTests.
//
// Truck rows do not go through WS_stpJob_Insert or UTL_stpJob_Truck_Insert
// (Steve 2026-11-04). This reproduces what those two procs and the booking API
// compute for a local NZ truck job, then BulkTruckPreflight supplies the values
// only SQL can answer (suburb ids, rate, fuel) and BulkTruckInserter writes it.
//
// Sources for the rules, read 2026-11-04:
//   WS_stpJob_Insert          DG note prefix, reference checks, after hours
//   UTL_stpJob_Truck_Insert   tucJob column values, street split, status
//   WebAPI GSS/Models/Package.cs                oversize and overweight counts
//   WebAPI JobRepository.PrepareJobItems        one item row per pallet
//   DES_fncTruckJob_IsVanOK                     VanOK
//   booking desktopHomeControl.js getPackageSizeString + bookJobObject   pallet note
//   WebAPI JobRepository.cs:4211-4219           Pickup Notes / Delivery Notes text
using System.Globalization;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;

namespace RoutedOperations.Core.Application.Services.BulkImport;

/// <summary>The one place that lists which truck speeds bulk import accepts.</summary>
public static class BulkTruckSpeeds
{
    // Truck Super, Express, Standard, Hourly, Bulk, Economy (Steve decision 4).
    // All six are exempt from the WS speed limitation check, so none can be
    // swapped for another speed. Add to this list to widen v1.
    public static readonly IReadOnlySet<int> Allowed = new HashSet<int> { 41, 42, 43, 44, 51, 52 };
}

public sealed record TruckClientFacts(
    int ClientId,
    string Code,
    int? TruckWeightLimit,
    bool IsBaggage,
    bool ReferenceAMandatory,
    string? ReferenceAMessage,
    bool ReferenceBMandatory,
    string? ReferenceBMessage);

/// <summary>A truck row plus what its caller knows about it, before any SQL.</summary>
public sealed class TruckRowInput
{
    public required BulkImportJobCreateDto Job { get; init; }
    public required int ClientId { get; init; }
    public required int SpeedId { get; init; }
    public required DateTime BookDateTime { get; init; }
    public bool Completed { get; init; }
    public string? PodName { get; init; }
    public DateTime? CompletedTime { get; init; }
    public int? OpId { get; init; }
    public int? LoggedInContactId { get; init; }
    public int? CourierId { get; init; }
    public string? PickupTimeZone { get; init; }
    public string? DeliverByTimeZone { get; init; }
    /// <summary>Position in the caller's list, so failures map back to the row.</summary>
    public int RowNo { get; init; }
}

public sealed class TruckItemRow
{
    public required string JobNumber { get; init; }
    public int ItemId { get; init; }
    public int Items { get; init; } = 1;
    public double Weight { get; init; }
    public double Length { get; init; }
    public double Height { get; init; }
    /// <summary>tucJobItems.Depth holds the row's width (prod job 26448453).</summary>
    public double Depth { get; init; }
    public bool PU { get; init; }
    public bool DO { get; init; }
    public int DGClass { get; init; }
    public string? Notes { get; init; }
    public decimal Cubic { get; init; }
    public string? Barcode { get; init; }
}

/// <summary>Everything computable from the row alone. Passed to the preflight.</summary>
public sealed class TruckRowPlan
{
    public required TruckRowInput Input { get; init; }
    public short Quantity { get; init; }
    public decimal WeightPerPallet { get; init; }
    public decimal TotalWeight { get; init; }
    public int TailLiftPickupCount { get; init; }
    public int TailLiftDropoffCount { get; init; }
    public int OverSizeItems { get; init; }
    public int OverWeightItems { get; init; }
    public bool Residential { get; init; }
    public bool DangerousGoods { get; init; }
    public bool DgDocument { get; init; }
    public DateTime? TruckStart { get; init; }
    public double? TruckHours { get; init; }
    public string? ComposedNotes { get; init; }
    /// <summary>The pickup tucNote text. The driver reads the pallet size from it (Steve ruling 1).</summary>
    public string? PickupNote { get; init; }
    /// <summary>Steve rulings 3 and 4, kept on the plan until Finalize adds any suburb warning.</summary>
    public string? Warning { get; init; }
    public string? WarningLevel { get; init; }
    public bool VanOk { get; init; }
    public decimal? StaffAmount { get; init; }
    public required IReadOnlyList<TruckItemRow> Items { get; init; }
}

public sealed record TruckPrepareResult(TruckRowPlan? Plan, string? Error);

/// <summary>What BulkTruckPreflight returns for one row.</summary>
public sealed class TruckPreflightRow
{
    public int RowNo { get; set; }
    public int FromSuburbId { get; set; }
    public int ToSuburbId { get; set; }
    public bool FromUnknown { get; set; }
    public bool ToUnknown { get; set; }
    public string? FromSuburbName { get; set; }
    public string? FromCity { get; set; }
    public string? FromPostCode { get; set; }
    public string? ToSuburbName { get; set; }
    public string? ToCity { get; set; }
    public string? ToPostCode { get; set; }
    public bool IsLocal { get; set; }
    public int EffectiveSpeedId { get; set; }
    public bool CanBook { get; set; } = true;
    public string? OutOfHoursMessage { get; set; }
    public decimal? AfterHoursAmount { get; set; }
    public int? AfterHoursCourierId { get; set; }
    public int? AutoDespatchCourierId { get; set; }
    public decimal? Rate { get; set; }
    public decimal? Fuel { get; set; }
    public int? DesiredJobTypeId { get; set; }
    public bool Direct { get; set; }
    public bool JobNumberExists { get; set; }
    public bool ReferenceAInList { get; set; } = true;
    public bool ReferenceBInList { get; set; } = true;
    public int? ContactId { get; set; }
    public int? PickupTimeZoneId { get; set; }
    public int? DeliverByTimeZoneId { get; set; }
    public int? JobRelationshipTypeId { get; set; }
    public int? AfterHoursStatusId { get; set; }
    public int? BookingStaffId { get; set; }
    public int? DeliveryNoteTypeId { get; set; }
    public int? PickupNoteTypeId { get; set; }
    public DateTime ServerNow { get; set; }
}

/// <summary>One tucJob row, property names equal to the column names on purpose.</summary>
public sealed class TruckInsertRow
{
    public int RowNo { get; init; }
    public string ClientCode { get; init; } = "";
    public bool MustInsertAlone { get; init; }
    public string? Warning { get; init; }
    public string? WarningLevel { get; init; }
    public string? PickupNote { get; init; }
    public int? PickupNoteTypeId { get; init; }
    public string? DeliveryNote { get; init; }
    public int? BookingStaffId { get; init; }
    public int? DeliveryNoteTypeId { get; init; }
    public IReadOnlyList<TruckItemRow> Items { get; init; } = Array.Empty<TruckItemRow>();

    public string ucjbNumber { get; init; } = "";
    public DateTime ucjbDate { get; init; }
    public DateTime ucjbTime { get; init; }
    public int ucjbType { get; init; } = 1;
    public int ucjbClientID { get; init; }
    public string? ucjbContact { get; init; }
    public int ucjbChargeType { get; init; } = 3;
    public decimal ucjbAmount { get; init; }
    public int ucjbSpeed { get; init; }
    public int ucjbFrom { get; init; }
    public string? ucjbFromAddr { get; init; }
    public int ucjbTo { get; init; }
    public string? ucjbToAddr { get; init; }
    public int ucjbSize { get; init; } = 4;
    public short ucjbQty { get; init; }
    public decimal ucjbWeight { get; init; }
    public int ucjbStatus { get; init; }
    public int? ucjbCourierID { get; init; }
    public DateTime? ucjbDispDate { get; init; }
    public DateTime? ucjbDispTime { get; init; }
    public int? ucjbDispID { get; init; }
    public bool ucjbJobDone { get; init; }
    public DateTime? ucjbComplTime { get; init; }
    public string? ucjbPODName { get; init; }
    public string? ucjbClientRefa { get; init; }
    public string? ucjbClientRefb { get; init; }
    public string? ucjbOurRef { get; init; }
    public int ucjbOpID { get; init; }
    public string? ucjbClientCode { get; init; }
    public string? ucjbNotes { get; init; }
    public string? PickupFromContact { get; init; }
    public string? DeliverToContact { get; init; }
    public string? DeliverToPhone { get; init; }
    public int ProofOfDelivery { get; init; }
    public string? ProofOfDeliveryEmail { get; init; }
    public string? ProofOfDeliveryMobile { get; init; }
    public int? ContactID { get; init; }
    public int? LoggedInContactID { get; init; }
    public int TrackingMethod { get; init; }
    public string? TrackingEmail { get; init; }
    public string? TrackingMobile { get; init; }
    public string? PickUpLatitude { get; init; }
    public string? PickUpLongitude { get; init; }
    public string? DeliveryLatitude { get; init; }
    public string? DeliveryLongitude { get; init; }
    public int? FromGeoType { get; init; }
    public int? ToGeoType { get; init; }
    public int? DesiredJobTypeID { get; init; }
    public bool Direct { get; init; }
    public int? JobRelationshipTypeID { get; init; }
    public DateTime? TruckStartTime { get; init; }
    public double? TruckHours { get; init; }
    public DateTime RequiredDeliveryTime { get; init; }
    public int DGClass { get; init; }
    public bool DGDocument { get; init; }
    public bool RatedManually { get; init; }
    public bool VanOK { get; init; }
    public string? PickupAddressLine1 { get; init; }
    public string? PickupAddressLine2 { get; init; }
    public string? PickupAddressLine3 { get; init; }
    public string? PickupAddressLine4 { get; init; }
    public string? PickupAddressLine5 { get; init; }
    public string? PickupAddressLine6 { get; init; }
    public string? PickupAddressLine7 { get; init; }
    public string? DeliveryAddressLine1 { get; init; }
    public string? DeliveryAddressLine2 { get; init; }
    public string? DeliveryAddressLine3 { get; init; }
    public string? DeliveryAddressLine4 { get; init; }
    public string? DeliveryAddressLine5 { get; init; }
    public string? DeliveryAddressLine6 { get; init; }
    public string? DeliveryAddressLine7 { get; init; }
    public int? PickupTimeZoneID { get; init; }
    public int? DeliverByTimeZoneID { get; init; }
}

public sealed record TruckFinalizeResult(TruckInsertRow? Row, string? Error);

public static class TruckWarningLevel
{
    /// <summary>The row imports, but Check Truck Prices flags it amber (Steve ruling 4).</summary>
    public const string Amber = "amber";
}

public static class TruckRowCalculator
{
    public const int DefaultTruckWeightLimit = 750;
    public const string DefaultPalletName = "Pallet";
    private const int MaxNotesLength = 4000;
    private const int MaxAddressLength = 150;
    private const int DefaultOpId = 126;
    private const int OnHoldStatus = 100;
    private const int CompletedStatus = 6;
    private const int DespatchedStatus = 1;
    private const int DefaultAfterHoursStatus = 75;
    // desktopHomeView.html:930 multiplies by this literal. Truck rows are NZ only.
    private const decimal NzGstMultiplier = 1.15m;

    // Client branches in tucJob_InsertJob, tucJob_Insert_DatacomCode and the
    // tucFTPJob block read one arbitrary row of `inserted` and test its client.
    // Rows for these clients always go in alone so that one row decides for
    // itself. Client 3191 and ids are matched by Code where the trigger does.
    private static readonly HashSet<string> SingleRowClientCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        "ZIMCH", "STRCH", "SCSDA", "ROREE", "DRIVE",
        "UCLBC", "DASCH", "UCLBD", "UCLBW", "SIMGW", "WOOPW", "KAIBO", "TFRCA", "FRAWE",
    };
    private static readonly HashSet<int> SingleRowClientIds = new() { 287, 3191 };

    public static bool IsSingleRowClient(int clientId, string? code)
    {
        if (SingleRowClientIds.Contains(clientId)) return true;
        var c = code?.Trim() ?? "";
        // tucJob_InsertJob: Code LIKE '#D___'
        if (c.Length == 5 && c.StartsWith("#D", StringComparison.OrdinalIgnoreCase)) return true;
        return SingleRowClientCodes.Contains(c);
    }

    // ---- row-only stage ----------------------------------------------------

    public static TruckPrepareResult Prepare(TruckRowInput input, TruckClientFacts client)
    {
        var job = input.Job;

        if (client.IsBaggage)
            return Fail("Truck jobs cannot be bulk imported for a baggage client.");
        if (string.IsNullOrWhiteSpace(job.FromContact))
            return Fail("From Contact is required on a truck job.");
        if (string.IsNullOrWhiteSpace(job.FromAddress))
            return Fail("From Address is required on a truck job.");
        if (string.IsNullOrWhiteSpace(job.ToAddress))
            return Fail("To Address is required on a truck job.");
        if (client.ReferenceAMandatory && string.IsNullOrWhiteSpace(job.ClientRefA))
            return Fail($"Reference A is required for this client ({client.ReferenceAMessage}).");
        if (client.ReferenceBMandatory && string.IsNullOrWhiteSpace(job.ClientRefB))
            return Fail($"Reference B is required for this client ({client.ReferenceBMessage}).");

        short qty = job.Quantity ?? 1;
        if (qty < 1) return Fail("Pallet count must be at least 1.");

        var weight = ResolveWeight(job.Weight, job.TotalWeight, qty);

        int dgClass = job.DgClass ?? 0;
        // The WS note prefix casts the class to one character, so only 1-9 survive.
        if (dgClass < 0 || dgClass > 9)
            return Fail($"DG class must be between 1 and 9. This row has {dgClass}.");
        bool dangerous = job.DangerousGoods == true || dgClass > 0;

        DateTime? truckStart = null;
        if (!string.IsNullOrWhiteSpace(job.TruckStart))
        {
            truckStart = ParseTruckStart(job.TruckStart!, input.BookDateTime);
            if (truckStart == null)
                return Fail($"Truck start '{job.TruckStart}' is not a time or date.");
        }

        string pickupNote = " " + PalletSizeString(qty, job.Length, job.Width, job.Height, weight.PerPallet);
        string? notes = ComposeNotes(ComposeJobNotes(pickupNote, job.Notes), dgClass, job.DgDocument == true);
        if (notes != null && notes.Length > MaxNotesLength)
            return Fail($"Notes are too long once the pallet and DG lines are added (limit {MaxNotesLength}).");

        bool pu = job.TailLiftPickup == true;
        bool dO = job.TailLiftDropoff == true;
        int limit = client.TruckWeightLimit ?? DefaultTruckWeightLimit;
        string jobNumber = job.JobNumber?.Trim() ?? "";

        return new TruckPrepareResult(new TruckRowPlan
        {
            Input = input,
            Quantity = qty,
            WeightPerPallet = weight.PerPallet,
            TotalWeight = weight.Total,
            // Tail lift is charged per unit, so the count is the pallet count
            // rather than 1. @Pickup and @Dropoff multiply the rate.
            TailLiftPickupCount = pu ? qty : 0,
            TailLiftDropoffCount = dO ? qty : 0,
            OverSizeItems = OverSizeItems(job.Length, job.Width, qty),
            OverWeightItems = weight.PerPallet > limit ? qty : 0,
            Residential = job.Residential == true,
            DangerousGoods = dangerous,
            DgDocument = job.DgDocument == true,
            TruckStart = truckStart,
            TruckHours = job.TruckHours,
            ComposedNotes = notes,
            PickupNote = pickupNote,
            Warning = RowWarning(job, weight),
            WarningLevel = MissingSizeOrWeight(job, weight).Count > 0 ? TruckWarningLevel.Amber : null,
            VanOk = IsVanOk(qty, weight.PerPallet, job.Length, job.Width, job.Height, pu, dO),
            StaffAmount = job.Amount is > 0 ? job.Amount : null,
            Items = BuildItems(jobNumber, qty, weight.PerPallet, job, pu, dO, dgClass),
        }, null);

        static TruckPrepareResult Fail(string message) => new(null, message);
    }

    public readonly record struct WeightResult(decimal PerPallet, decimal Total);

    /// <summary>
    /// Steve decision 2. A Weight column is per pallet; otherwise Total weight is
    /// divided by the pallet count. When a row gives both, Weight is used and
    /// RowWarning says so (Steve ruling 3).
    /// </summary>
    public static WeightResult ResolveWeight(decimal perPallet, decimal? total, short qty)
    {
        if (perPallet > 0) return new(perPallet, perPallet * qty);
        if (total is > 0) return new(Math.Round(total.Value / qty, 4, MidpointRounding.AwayFromZero), total.Value);
        return new(0, 0);
    }

    // Zero is what the row's own parsing leaves for an empty cell, after any stock
    // size has filled what it can.
    private static List<string> MissingSizeOrWeight(BulkImportJobCreateDto job, WeightResult weight)
    {
        var missing = new List<string>();
        if (weight.PerPallet <= 0) missing.Add("weight");
        if (job.Length <= 0) missing.Add("length");
        if (job.Width <= 0) missing.Add("width");
        if (job.Height <= 0) missing.Add("height");
        return missing;
    }

    private static string? RowWarning(BulkImportJobCreateDto job, WeightResult weight)
    {
        var parts = new List<string>();
        if (job.Weight > 0 && job.TotalWeight is > 0)
            parts.Add($"Weight and Total weight are both given. Weight was used ({Js(job.Weight)} per pallet).");
        var missing = MissingSizeOrWeight(job, weight);
        if (missing.Count > 0)
            parts.Add($"No {string.Join(", ", missing)} on this row, so the price may be too low.");
        return parts.Count == 0 ? null : string.Join(" ", parts);
    }

    /// <summary>Same arithmetic and truncation as WebAPI Package.GetOverSizeItems.</summary>
    public static int OverSizeItems(decimal length, decimal width, short units)
    {
        if (length > 120 && width > 120) return (int)(((length / 120 * 2) + 1) * units);
        if (length > 120 && width <= 120) return (int)(length / 120 * units);
        if (length <= 120 && width > 120) return units;
        return 0;
    }

    /// <summary>
    /// Copy of DES_fncTruckJob_IsVanOK, including its limits. They read like
    /// metres while items are in cm, so this is false for any real pallet. It is
    /// copied rather than corrected so a bulk job matches a booking-page job.
    /// </summary>
    public static bool IsVanOk(short qty, decimal weight, decimal length, decimal width, decimal height, bool pu, bool dO) =>
        qty == 1 && weight < 750 && length <= 1.2m && width <= 1m && height <= 1.2m && !pu && !dO;

    /// <summary>
    /// The booking page's getPackageSizeString for a truck job with one package row,
    /// which is all a bulk row can be. "(LB)" is literal in the page on every tenant
    /// even though NZ weights are kg, and is kept so the two jobs read the same.
    /// </summary>
    public static string PalletSizeString(short qty, decimal length, decimal width, decimal height, decimal weightPerPallet) =>
        $"{qty}x Pallet{(qty > 1 ? "s" : "")}: {qty} @ {Js(length)}(L) x {Js(width)}(W) x {Js(height)}(H) - {Js(weightPerPallet)}(LB)";

    // A JavaScript number as the page would print it: 120, not 120.00.
    private static string Js(decimal value) =>
        value.ToString("0.############################", CultureInfo.InvariantCulture);

    /// <summary>WebAPI JobRepository.cs:4211-4219. A blank delivery note leaves its half out.</summary>
    public static string ComposeJobNotes(string pickupNote, string? deliveryNote) =>
        string.IsNullOrWhiteSpace(deliveryNote)
            ? $"Pickup Notes: {pickupNote}"
            : $"Pickup Notes: {pickupNote}, Delivery Notes: {deliveryNote}";

    /// <summary>WS_stpJob_Insert:942-944. Row notes come after the DG line.</summary>
    public static string? ComposeNotes(string? notes, int dgClass, bool hasDocument)
    {
        var body = string.IsNullOrEmpty(notes) ? null : notes;
        if (dgClass <= 0) return body;
        var line = $"DG Class: {dgClass}{(hasDocument ? " and has documentation" : "")}";
        return body == null ? line : line + "\r\n" + body;
    }

    /// <summary>
    /// UTL_stpJob_Truck_Insert street split: the space stays on BOTH sides
    /// ("17 " and " Saleyards Road"), and number and name are capped by the
    /// proc's nvarchar(20) and SUBSTRING(..., 100). With no space, CHARINDEX is
    /// 0, so the number is empty and SUBSTRING from 0 gives the first 99 chars.
    /// </summary>
    public static (string Number, string Name) SplitStreet(string street)
    {
        int firstSpace = street.IndexOf(' ');
        if (firstSpace < 0)
            return ("", street.Length > 99 ? street[..99] : street);
        var number = street[..(firstSpace + 1)];
        var name = street[firstSpace..];
        return (number.Length > 20 ? number[..20] : number, name.Length > 100 ? name[..100] : name);
    }

    public static IReadOnlyList<TruckItemRow> BuildItems(
        string jobNumber, short qty, decimal weightPerPallet, BulkImportJobCreateDto job, bool pu, bool dO, int dgClass)
    {
        var name = string.IsNullOrWhiteSpace(job.PalletType) ? DefaultPalletName : job.PalletType!.Trim();
        var cubic = job.Length * job.Width * job.Height / 1000000m;
        var items = new List<TruckItemRow>(qty);
        for (int i = 0; i < qty; i++)
        {
            items.Add(new TruckItemRow
            {
                JobNumber = jobNumber,
                ItemId = i,
                Items = 1,
                Weight = (double)weightPerPallet,
                Length = (double)job.Length,
                Height = (double)job.Height,
                Depth = (double)job.Width,
                PU = pu,
                DO = dO,
                DGClass = dgClass,
                Notes = name,
                Cubic = cubic,
                // JobRepository.PrepareJobItems: a number that already carries
                // a dash is used as it is.
                Barcode = jobNumber.Contains('-') ? jobNumber : $"{jobNumber}-{i + 1}",
            });
        }
        return items;
    }

    private static DateTime? ParseTruckStart(string value, DateTime bookDateTime)
    {
        var inv = CultureInfo.InvariantCulture;
        if (TimeSpan.TryParse(value.Trim(), inv, out var time) && time >= TimeSpan.Zero && time < TimeSpan.FromDays(1))
            return bookDateTime.Date.Add(time);
        return DateTime.TryParse(value.Trim(), inv, DateTimeStyles.None, out var dt) ? dt : null;
    }

    // ---- after the preflight ------------------------------------------------

    public static TruckFinalizeResult Finalize(TruckRowPlan plan, TruckPreflightRow pre, TruckClientFacts client, string? speedLabel = null)
    {
        var input = plan.Input;
        var job = input.Job;
        var label = speedLabel ?? $"speed {input.SpeedId}";

        if (pre.JobNumberExists)
            return Fail($"Job number {job.JobNumber} already exists.");
        if (!pre.ReferenceAInList)
            return Fail($"Reference A '{job.ClientRefA}' is not in this client's list.");
        if (!pre.ReferenceBInList)
            return Fail($"Reference B '{job.ClientRefB}' is not in this client's list.");
        if (!pre.CanBook)
            return Fail(string.IsNullOrWhiteSpace(pre.OutOfHoursMessage)
                ? "This speed cannot be booked at this time."
                : pre.OutOfHoursMessage!);

        // Steve decision 3. The booking path would send this to nationwide, not truck.
        if (!pre.IsLocal)
            return Fail($"Pickup ({job.FromSuburb}) and delivery ({job.ToSuburb}) are in different regions. Truck jobs must stay within one region, so this row was not imported.");

        // Steve decision 4: never insert at $0. Decision 1: staff Amount is the exception.
        decimal amount;
        bool ratedManually = plan.StaffAmount.HasValue;
        if (ratedManually)
        {
            amount = plan.StaffAmount!.Value;
        }
        else
        {
            if (pre.Rate is null or <= 0 || pre.Fuel is null)
                return Fail($"No truck rate for {label} from {job.FromSuburb} to {job.ToSuburb}. The row was not imported. Add a rate for this client, or have staff enter an Amount.");
            amount = pre.Rate.Value + pre.Fuel.Value;
        }

        var fromAddress = CompanyAddress(job.FromCompany, job.FromAddress);
        var toAddress = CompanyAddress(job.ToCompany, job.ToAddress);
        string? warning = plan.Warning;
        // WS_stpJob_Insert:593-599: an unknown suburb keeps the typed name in the address.
        if (pre.FromUnknown)
        {
            fromAddress = $"{fromAddress},{job.FromSuburb}";
            warning = (warning == null ? "" : warning + " ") + $"Pickup suburb '{job.FromSuburb}' was not recognised.";
        }
        if (pre.ToUnknown)
        {
            toAddress = $"{toAddress},{job.ToSuburb}";
            warning = (warning == null ? "" : warning + " ") + $"Delivery suburb '{job.ToSuburb}' was not recognised.";
        }
        if (fromAddress.Length > MaxAddressLength) return Fail($"From address is over {MaxAddressLength} characters with the company name.");
        if (toAddress.Length > MaxAddressLength) return Fail($"To address is over {MaxAddressLength} characters with the company name.");

        int? courierId = input.CourierId ?? pre.AfterHoursCourierId ?? pre.AutoDespatchCourierId;
        int opId = input.OpId ?? DefaultOpId;
        int status = ResolveStatus(courierId, pre.AfterHoursAmount, pre.AfterHoursStatusId, input.Completed, job.OnHold == true);

        string? proofEmail = input.Completed ? null : Blank(job.TrackingEmail);
        string? proofMobile = input.Completed ? null : Blank(job.ToContactPhone);
        string? trackEmail = input.Completed ? null : Blank(job.TrackingEmail);
        // Steve ruling 2: a delivery phone turns on text tracking. It goes in
        // TrackingMobile because that is the column SMPP_qdfJobUpdatesPickup_
        // TrakingNoticationSend texts. The booking page does not reach it: WS_stpJob_Insert
        // passes email then mobile into UTL_stpJob_Truck_Insert's @TrackingMobile,
        // @TrackingEmail, so its truck jobs hold the phone in TrackingEmail.
        string? trackMobile = input.Completed ? null : Blank(job.TrackingMobile) ?? Blank(job.ToContactPhone);
        var (fromNumber, fromName) = SplitStreet(job.FromAddress!);
        var (toNumber, toName) = SplitStreet(job.ToAddress!);
        var book = input.BookDateTime;
        var clientCode = client.Code;

        return new TruckFinalizeResult(new TruckInsertRow
        {
            RowNo = input.RowNo,
            ClientCode = clientCode,
            // Courier rows run the SMS and clear-list trigger branches on one
            // arbitrary inserted row, so they never share a statement (section C).
            MustInsertAlone = courierId.HasValue || IsSingleRowClient(input.ClientId, clientCode),
            Warning = warning,
            WarningLevel = plan.WarningLevel,
            PickupNote = plan.PickupNote,
            PickupNoteTypeId = pre.PickupNoteTypeId,
            // Steve decision 5: row notes stay in ucjbNotes and the delivery tucNote.
            DeliveryNote = string.IsNullOrWhiteSpace(job.Notes) ? null : job.Notes.Trim(),
            BookingStaffId = pre.BookingStaffId,
            DeliveryNoteTypeId = pre.DeliveryNoteTypeId,
            Items = plan.Items,
            ucjbNumber = job.JobNumber!.Trim(),
            ucjbDate = book.Date,
            ucjbTime = new DateTime(1899, 12, 30, book.Hour, book.Minute, 0),
            ucjbClientID = input.ClientId,
            // tucJob.ucjbContact is 30 chars, as @Contact on the truck proc. PickupFromContact keeps the full name.
            ucjbContact = job.FromContact!.Trim() is { Length: > 30 } longContact ? longContact[..30] : job.FromContact!.Trim(),
            ucjbAmount = amount,
            ucjbSpeed = pre.EffectiveSpeedId,
            ucjbFrom = pre.FromSuburbId,
            ucjbFromAddr = fromAddress,
            ucjbTo = pre.ToSuburbId,
            ucjbToAddr = toAddress,
            ucjbQty = plan.Quantity,
            ucjbWeight = plan.TotalWeight,
            ucjbStatus = status,
            ucjbCourierID = courierId,
            ucjbDispDate = courierId.HasValue ? pre.ServerNow.Date : null,
            ucjbDispTime = courierId.HasValue ? new DateTime(1900, 1, 1).Add(pre.ServerNow.TimeOfDay) : null,
            ucjbDispID = courierId.HasValue ? opId : null,
            ucjbJobDone = input.Completed,
            ucjbComplTime = input.Completed ? input.CompletedTime : null,
            ucjbPODName = input.PodName,
            ucjbClientRefa = job.ClientRefA ?? "",
            ucjbClientRefb = job.ClientRefB ?? "",
            ucjbOurRef = job.OurRef ?? "",
            ucjbOpID = opId,
            ucjbClientCode = clientCode,
            ucjbNotes = plan.ComposedNotes,
            PickupFromContact = job.FromContact!.Trim(),
            DeliverToContact = job.ToContact,
            DeliverToPhone = job.ToContactPhone,
            ProofOfDelivery = NotifyMethod(proofEmail, proofMobile),
            ProofOfDeliveryEmail = proofEmail,
            ProofOfDeliveryMobile = proofMobile,
            ContactID = pre.ContactId,
            LoggedInContactID = input.LoggedInContactId,
            TrackingMethod = NotifyMethod(trackEmail, trackMobile),
            TrackingEmail = trackEmail,
            TrackingMobile = trackMobile,
            PickUpLatitude = Blank(job.FromLatitude),
            PickUpLongitude = Blank(job.FromLongitude),
            DeliveryLatitude = Blank(job.ToLatitude),
            DeliveryLongitude = Blank(job.ToLongitude),
            FromGeoType = job.FromGeoType,
            ToGeoType = job.ToGeoType,
            DesiredJobTypeID = pre.DesiredJobTypeId,
            Direct = pre.Direct,
            JobRelationshipTypeID = pre.JobRelationshipTypeId,
            TruckStartTime = plan.TruckStart,
            TruckHours = plan.TruckHours,
            RequiredDeliveryTime = book,
            // The proc writes the bit to tucJob.DGClass. The real class is on the items.
            DGClass = plan.DangerousGoods ? 1 : 0,
            DGDocument = plan.DgDocument,
            RatedManually = ratedManually,
            VanOK = plan.VanOk,
            PickupAddressLine1 = Blank(job.FromCompany),
            PickupAddressLine2 = Blank(job.FromUnit),
            PickupAddressLine3 = fromNumber,
            PickupAddressLine4 = fromName,
            PickupAddressLine5 = pre.FromSuburbName,
            PickupAddressLine6 = pre.FromCity,
            PickupAddressLine7 = pre.FromPostCode,
            DeliveryAddressLine1 = Blank(job.ToCompany),
            DeliveryAddressLine2 = Blank(job.ToUnit),
            DeliveryAddressLine3 = toNumber,
            DeliveryAddressLine4 = toName,
            DeliveryAddressLine5 = pre.ToSuburbName,
            DeliveryAddressLine6 = pre.ToCity,
            DeliveryAddressLine7 = pre.ToPostCode,
            PickupTimeZoneID = pre.PickupTimeZoneId,
            DeliverByTimeZoneID = pre.DeliverByTimeZoneId,
        }, null);

        static TruckFinalizeResult Fail(string message) => new(null, message);
    }

    /// <summary>The booking page's Incl GST figure, desktopHomeView.html:930.</summary>
    public static decimal AmountInclGst(decimal amount) =>
        Math.Round(amount * NzGstMultiplier, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// The page's splitDescription + fixedDecimal over the rate function's
    /// PublicDescription: "Name = $1.23" per line, split on CR.
    /// </summary>
    public static IReadOnlyList<BulkTruckPriceLine> ParsePriceLines(string? description)
    {
        var lines = new List<BulkTruckPriceLine>();
        if (string.IsNullOrEmpty(description)) return lines;
        foreach (var line in description.Split('\r'))
        {
            var parts = line.Split('=');
            if (parts.Length < 2) continue;
            var value = parts[1];
            int tilde = value.LastIndexOf('~');
            if (tilde >= 0) value = value[..tilde];
            if (decimal.TryParse(value.Replace("$", "").Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var amount))
                lines.Add(new BulkTruckPriceLine { Label = parts[0].Trim(), Amount = Math.Round(amount, 2, MidpointRounding.AwayFromZero) });
        }
        return lines;
    }

    public static int ResolveStatus(int? courierId, decimal? afterHoursAmount, int? afterHoursStatusId, bool completed, bool onHold)
    {
        int status = courierId.HasValue ? DespatchedStatus : 0;
        if (afterHoursAmount is > 0) status = afterHoursStatusId ?? DefaultAfterHoursStatus;
        if (completed) status = CompletedStatus;
        if (onHold) status = OnHoldStatus;
        return status;
    }

    /// <summary>INT_stpJob_BulkInsert:117-131. Always non-null, which keeps the trigger's POD branch off the batch.</summary>
    public static int NotifyMethod(string? email, string? mobile)
    {
        bool hasEmail = !string.IsNullOrEmpty(email);
        bool hasMobile = !string.IsNullOrEmpty(mobile);
        return hasEmail && hasMobile ? 3 : hasEmail ? 1 : hasMobile ? 2 : 0;
    }

    private static string CompanyAddress(string? company, string? address) =>
        string.IsNullOrEmpty(company) ? address ?? "" : $"{company}, {address}";

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
