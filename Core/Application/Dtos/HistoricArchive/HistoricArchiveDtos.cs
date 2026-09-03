// DTOs for the Historic Archive Upload feature. Single file so the
// preview / commit / batch shapes stay together and are easy to keep
// in sync with the frontend service types.
//
// Naming: the wire shape uses lowerCamelCase (Program.cs configures
// CamelCasePropertyNamesContractResolver). Property names are PascalCase.
//
// Row dictionary caveat: CamelCasePropertyNamesContractResolver has
// ProcessDictionaryKeys = true by default, so a raw Dictionary<string,
// string?> would ship "JobNumber" over the wire as "jobNumber" and the
// server's mapping lookup by original header name would miss. Every
// Rows property is annotated with PreserveKeysDictConverter which
// bypasses the resolver's key-renaming so header names round-trip
// verbatim.

using Newtonsoft.Json;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Core.Application.Dtos.HistoricArchive;

/// <summary>Canonical archive field names the operator maps their file
/// columns to. Kept as string constants (not an enum) so the frontend
/// can pass the value straight through without a shared enum contract.</summary>
public static class HistoricArchiveField
{
    // Core job identity + timing
    public const string JobNumber            = "JobNumber";            // -> UcjbNumber
    public const string JobDate              = "JobDate";              // -> UcjbDate (DateTime)
    public const string PickupTime           = "PickupTime";           // -> UcjbTime
    public const string CompletedTime        = "CompletedTime";        // -> UcjbComplTime; falls back to JobDate if absent
    public const string RequiredDeliveryTime = "RequiredDeliveryTime"; // -> RequiredDeliveryTime
    public const string DeliverByTime        = "DeliverByTime";        // -> DeliverByTime
    public const string PickupArrivalTime    = "PickupArrivalTime";    // -> PickupArrivalTime
    public const string DeliveryArrivalTime  = "DeliveryArrivalTime";  // -> DeliveryArrivalTime

    // Client + references
    public const string ClientCode           = "ClientCode";           // -> UcjbClientCode (used to look up UcjbClientId)
    public const string ClientId             = "ClientId";             // -> UcjbClientId (bypass lookup if operator supplies the int)
    public const string ClientRefA           = "ClientRefA";           // -> UcjbClientRefa
    public const string ClientRefB           = "ClientRefB";           // -> UcjbClientRefb
    public const string ClientRefC           = "ClientRefC";           // -> UcjbClientRefc
    public const string OurRef               = "OurRef";               // -> UcjbOurRef
    public const string Connote              = "Connote";              // -> Connote
    public const string Barcode              = "Barcode";              // -> Barcode
    public const string CustomJobName        = "CustomJobName";        // -> CustomJobName
    public const string TextRef1             = "TextRef1";             // -> TextRef1
    public const string TextRef2             = "TextRef2";             // -> TextRef2
    public const string TextRef3             = "TextRef3";             // -> TextRef3
    public const string TextRef4             = "TextRef4";             // -> TextRef4
    public const string NumRef1              = "NumRef1";              // -> NumRef1
    public const string NumRef2              = "NumRef2";              // -> NumRef2
    public const string NumRef3              = "NumRef3";              // -> NumRef3
    public const string NumRef4              = "NumRef4";              // -> NumRef4

    // Delivery party + address
    public const string CustomerName         = "CustomerName";         // -> DeliveryAddressLine1 (delivery company)
    public const string DeliveryAddress1     = "DeliveryAddress1";     // -> DeliveryAddressLine2 (street line 1)
    public const string DeliveryAddress2     = "DeliveryAddress2";     // -> DeliveryAddressLine3 (unit/suite)
    public const string DeliveryAddress4     = "DeliveryAddress4";     // -> DeliveryAddressLine4 (extra address line, unused prior)
    public const string DeliveryAddressCity  = "DeliveryAddressCity";  // -> DeliveryAddressLine5
    public const string DeliveryState        = "DeliveryState";        // -> DeliveryAddressLine6
    public const string DeliveryPostCode     = "DeliveryPostCode";     // -> DeliveryAddressLine7
    public const string DeliveryContact      = "DeliveryContact";      // -> DeliverToContact
    public const string DeliveryPhone        = "DeliveryPhone";        // -> DeliverToPhone

    // Pickup party + address
    public const string PickupCompany        = "PickupCompany";        // -> PickUpFromContact (pickup name/company/contact)
    public const string PickupAddress1       = "PickupAddress1";       // -> PickupAddressLine1
    public const string PickupAddress2       = "PickupAddress2";       // -> PickupAddressLine2
    public const string PickupAddress3       = "PickupAddress3";       // -> PickupAddressLine3
    public const string PickupAddress4       = "PickupAddress4";       // -> PickupAddressLine4
    public const string PickupAddressCity    = "PickupAddressCity";    // -> PickupAddressLine5
    public const string PickupState          = "PickupState";          // -> PickupAddressLine6
    public const string PickupPostCode       = "PickupPostCode";       // -> PickupAddressLine7
    public const string PickupContact        = "PickupContact";        // -> PickUpFromContact (same column as PickupCompany; last-writer-wins if both mapped)
    public const string PickupPhone          = "PickupPhone";          // -> PickUpFromPhone

    // Order-level contact (client-side)
    public const string Contact              = "Contact";              // -> UcjbContact
    public const string ContactPhone         = "ContactPhone";         // -> UcjbContactPhone

    // Courier
    public const string CourierCode          = "CourierCode";          // -> future lookup to tucCourier.uccrID (deferred)
    public const string CourierId            = "CourierId";            // -> UcjbCourierId

    // Freight / product
    public const string Amount               = "Amount";               // -> UcjbAmount
    public const string Weight               = "Weight";               // -> UcjbWeight
    public const string Quantity             = "Quantity";             // -> UcjbQty

    // Notes + POD
    public const string Notes                = "Notes";                // -> UcjbNotes
    public const string ClientNotes          = "ClientNotes";          // -> ClientNotes
    public const string InternalNotes        = "InternalNotes";        // -> InternalNotes
    public const string PodName              = "PodName";              // -> UcjbPodname

    // Money pass-through
    public const string CourierPayment       = "CourierPayment";       // -> CourierPayment
    public const string CourierFuel          = "CourierFuel";          // -> CourierFuel
    public const string CourierBonus         = "CourierBonus";         // -> CourierBonus
    public const string CourierPercentage    = "CourierPercentage";    // -> CourierPercentage
    public const string FuelSurchargeAmount  = "FuelSurchargeAmount";  // -> FuelSurchargeAmount
    public const string PpdAmount            = "PpdAmount";            // -> PpdAmount
    public const string PpdExclusiveAmount   = "PpdExclusiveAmount";   // -> PpdExclusiveAmount
    public const string RawBaseAmount        = "RawBaseAmount";        // -> RawBaseAmount

    // Service / booking metadata
    public const string Speed                = "Speed";                // -> UcjbSpeed (int, operator supplies pre-resolved ID)
    public const string ServiceName          = "ServiceName";          // -> UcjbSpeed via tucJobType.ucjtName lookup at commit
    public const string VehicleName          = "VehicleName";          // -> UcjbSize via VehicleSize.VehicleName lookup at commit
    public const string BookedBy             = "BookedBy";             // -> UcjbOpId (Ops/CSR who booked)
    public const string RunName              = "RunName";              // -> RunName
    public const string ScheduleName         = "ScheduleName";         // -> ScheduleName

    /// <summary>Every canonical field the mapper knows about. Sent to the
    /// frontend so the Map Columns UI can render the dropdown of choices
    /// without hard-coding the list twice. Order is used as the default
    /// display order when the UI does not apply its own group ordering.</summary>
    public static readonly string[] All =
    [
        // Core job + timing
        JobNumber, JobDate, PickupTime, CompletedTime,
        RequiredDeliveryTime, DeliverByTime, PickupArrivalTime, DeliveryArrivalTime,
        // Client + references
        ClientCode, ClientId,
        ClientRefA, ClientRefB, ClientRefC, OurRef,
        Connote, Barcode, CustomJobName,
        TextRef1, TextRef2, TextRef3, TextRef4,
        NumRef1, NumRef2, NumRef3, NumRef4,
        // Delivery
        CustomerName, DeliveryAddress1, DeliveryAddress2, DeliveryAddress4,
        DeliveryAddressCity, DeliveryState, DeliveryPostCode,
        DeliveryContact, DeliveryPhone,
        // Pickup
        PickupCompany, PickupAddress1, PickupAddress2, PickupAddress3, PickupAddress4,
        PickupAddressCity, PickupState, PickupPostCode,
        PickupContact, PickupPhone,
        // Order-level contact
        Contact, ContactPhone,
        // Courier
        CourierCode, CourierId,
        // Freight
        Amount, Weight, Quantity,
        // Notes + POD
        Notes, ClientNotes, InternalNotes, PodName,
        // Money
        CourierPayment, CourierFuel, CourierBonus, CourierPercentage, FuelSurchargeAmount,
        PpdAmount, PpdExclusiveAmount, RawBaseAmount,
        // Service / booking metadata
        Speed, ServiceName, VehicleName, BookedBy, RunName, ScheduleName,
    ];

    /// <summary>Fields the operator MUST map for the commit to proceed.
    /// The rest are optional and default to null.</summary>
    public static readonly string[] Required =
    [
        JobNumber, JobDate, ClientCode,
    ];
}

/// <summary>POST /api/historic-archive/upload response body. Contains the
/// parsed grid plus the canonical field list the wizard renders on its
/// Map Columns step.</summary>
public class HistoricArchiveUploadResponse
{
    public string FileName { get; set; } = string.Empty;
    public List<string> Headers { get; set; } = new();
    [JsonProperty(ItemConverterType = typeof(PreserveKeysDictConverter))]
    public List<Dictionary<string, string?>> Rows { get; set; } = new();
    public List<string> CanonicalFields { get; set; } = new();
    public List<string> RequiredFields { get; set; } = new();
}

/// <summary>POST /api/historic-archive/commit request body.</summary>
public class HistoricArchiveCommitRequest
{
    /// <summary>File name (echoed from the upload response).</summary>
    public string FileName { get; set; } = string.Empty;

    /// <summary>Operator's column-name -> canonical-field mapping.
    /// Key = header from the uploaded file. Value = one of HistoricArchiveField.*.
    /// Unmapped headers are ignored.</summary>
    public Dictionary<string, string> Mapping { get; set; } = new();

    /// <summary>The rows as returned by /upload (same shape).</summary>
    [JsonProperty(ItemConverterType = typeof(PreserveKeysDictConverter))]
    public List<Dictionary<string, string?>> Rows { get; set; } = new();

    /// <summary>Optional freeform note attached to the batch audit row.</summary>
    public string? Notes { get; set; }
}

/// <summary>POST /api/historic-archive/commit response body.</summary>
public class HistoricArchiveCommitResponse
{
    public int BatchId { get; set; }
    public int InsertedCount { get; set; }
    public int RejectedCount { get; set; }
    public int? ImportedIdStart { get; set; }
    public int? ImportedIdEnd { get; set; }
    public List<HistoricArchiveRowError> Errors { get; set; } = new();
}

/// <summary>Per-row validation failure. RowIndex is 1-based against the
/// uploaded file's data rows (header excluded).</summary>
public class HistoricArchiveRowError
{
    public int RowIndex { get; set; }
    public string? JobNumber { get; set; }
    public string Message { get; set; } = string.Empty;
}

/// <summary>GET /api/historic-archive/batches list item. Deliberately
/// omits the Errors payload - the list endpoint doesn't project it so
/// history-view responses stay lean. Fetch a single batch via GET
/// /api/historic-archive/batches/{id} for the full detail including
/// deserialised errors.</summary>
public class HistoricArchiveBatchDto
{
    public int Id { get; set; }
    public DateTime UploadedAt { get; set; }
    public int UploadedByContact { get; set; }
    /// <summary>Resolved from TucClientContacts via UploadedByContact.
    /// Null when the contact has been deleted or was never in the tenant
    /// (e.g. an internal-staff import against a foreign tenant).</summary>
    public string? UploadedByName { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string TenantCode { get; set; } = string.Empty;
    public int RowCount { get; set; }
    public int InsertedCount { get; set; }
    public int RejectedCount { get; set; }
    /// <summary>Distinct client codes ({ucclCode}) across every archive
    /// row in the batch's ImportedIdStart..ImportedIdEnd range. Comma-
    /// joined for compact display. Empty when the batch had 0 inserts.</summary>
    public string? ClientCodes { get; set; }
    public string? Notes { get; set; }
    public int? ImportedIdStart { get; set; }
    public int? ImportedIdEnd { get; set; }
}

/// <summary>GET /api/historic-archive/batches/{id} single-batch response.
/// Extends the list DTO with the deserialised per-row error list.</summary>
public class HistoricArchiveBatchDetailDto : HistoricArchiveBatchDto
{
    public List<HistoricArchiveRowError> Errors { get; set; } = new();
}

/// <summary>Row shape for GET /api/historic-archive/batches/{id}/jobs.
/// Slim projection over tucJobArchive filtered to the batch's contiguous
/// ID range (ImportedIdStart..End) and SourceID = 900. Column set is
/// what the drill-down drawer needs to render for ops audit; deliberate
/// subset of the ~268 archive columns so the wire payload stays small
/// even for batches that inserted 20k rows.</summary>
public class HistoricArchiveJobDto
{
    public int UcjbId { get; set; }
    public string? JobNumber { get; set; }
    public string? ClientCode { get; set; }
    public int? ClientId { get; set; }
    public DateTime JobDate { get; set; }
    public DateTime? CompletedTime { get; set; }
    public decimal? Amount { get; set; }
    public decimal? CourierPayment { get; set; }
    public string? PodName { get; set; }
    public string? ClientRefA { get; set; }
    public string? ClientRefB { get; set; }
    public string? OurRef { get; set; }
    public string? Notes { get; set; }
    public string? DeliveryCompany { get; set; }
    public string? DeliveryAddress { get; set; }
    public string? DeliveryCity { get; set; }
    public string? DeliveryPostCode { get; set; }
}

/// <summary>Envelope for GET /api/historic-archive/batches/{id}/jobs.
/// Carries the current-page rows plus the total row count in the range
/// so the drawer can render pagination without a second HEAD call.</summary>
public class HistoricArchiveJobsPage
{
    public int Total { get; set; }
    public int Limit { get; set; }
    public int Offset { get; set; }
    public List<HistoricArchiveJobDto> Rows { get; set; } = new();
}
