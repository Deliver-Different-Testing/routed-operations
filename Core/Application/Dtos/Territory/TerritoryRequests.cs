using System.ComponentModel.DataAnnotations;

namespace RoutedOperations.Core.Application.Dtos.Territory;

public class PostcodeGroupUpsertRequest
{
    [Required, StringLength(200)] public string Name { get; set; } = string.Empty;
    public int? DepotId { get; set; }
    /// <summary>Client CODE (preferred - what operators use, e.g. "ACME"). If null / empty, group is client-agnostic.
    /// If both this and ClientId are provided, code wins and gets resolved server-side.</summary>
    public string ClientCode { get; set; }
    /// <summary>Legacy id-based path. Kept for internal callers; operators should send ClientCode.</summary>
    public int? ClientId { get; set; }
}

public class NzPostcodeUpsertRequest
{
    [Required] public int PostCode { get; set; }
    public int Zone { get; set; }
    public int? DepotId { get; set; }
    public int? PostcodeGroupId { get; set; }
    public int FromSiteId { get; set; }
    public string Name { get; set; }
    public string FromLatLng { get; set; }
}

public class UsZipZoneUpsertRequest
{
    [Required, StringLength(20)] public string Zip { get; set; } = string.Empty;
    public int? ZoneNumber { get; set; }
    public int? ZoneNameId { get; set; }
    public int? ZoneZipGroupId { get; set; }
    public bool? ApplyCongestion { get; set; }
    public int? ClientId { get; set; }
}

/// <summary>
/// Add many ZIPs to one US zone in a single call.
///
/// The Zones tab adds one ZIP per request, which is 602 form submissions for
/// Cheetah's Hub Group file, so this is the bulk path (US coverage spec 5.3).
/// </summary>
public class ZoneZipPasteRequest
{
    /// <summary>
    /// Pasted ZIPs. Accepted as typed, in any of the separators the postcode
    /// pickers accept, and normalised server-side so the stored spelling is
    /// decided in one place rather than by whichever client called.
    /// </summary>
    [Required] public List<string> Zips { get; set; } = new();

    /// <summary>
    /// Required, and it is the key a schedule leg tick resolves by (decision
    /// D1 of the coverage spec, as reversed on 27 Oct). A coverage row with no
    /// number can never be reached by a tick, so there is no useful default.
    /// </summary>
    [Required, Range(1, int.MaxValue)] public int ZoneNumber { get; set; }

    /// <summary>Only when the zone exists for one client's schedules.
    /// NULL means every client, which is the normal case.</summary>
    public int? ClientId { get; set; }

    /// <summary>
    /// Two zones at one depot sharing a number is legitimate and means the
    /// tick covers both (Medical Couriers depot 35), but it widens coverage,
    /// so it has to be asked for rather than happen by accident.
    /// </summary>
    public bool AllowSharedNumber { get; set; }
}

public class ZoneNameUpsertRequest
{
    [Required, StringLength(200)] public string Name { get; set; } = string.Empty;
    public int? ZoneGroupId { get; set; }
    public int? LocationId { get; set; }
}

public class ZoneGroupUpsertRequest
{
    [Required, StringLength(200)] public string Name { get; set; } = string.Empty;
    public int? ClearListAreaId { get; set; }
}

/// <summary>Bind (or clear) a polygon's zone / postcode-group binding.
/// Either field may be null; null on both clears every binding.</summary>
public class PolygonBindRequest
{
    public int? ZoneNameId { get; set; }
    public int? PostcodeGroupId { get; set; }
}

/// <summary>Resolve which ZipPolygon rows the Schedule editor map should
/// render for the currently-edited schedule. Splits into two buckets so
/// the map can paint bound (directly-junctioned) postcodes distinctly
/// from zone-derived postcodes (matched via BulkZonePostcode on the
/// schedule's destination depot).</summary>
public class PostcodesForScheduleRequest
{
    /// <summary>Destination depot for the schedule (TblBulkRunSchedule.Region).</summary>
    public int? DepotId { get; set; }
    /// <summary>Active zone numbers on the schedule (BulkZoneSchedule.Zone
    /// where Active=true).</summary>
    public List<int> Zones { get; set; } = new();
    /// <summary>Postcode ints bound via tblSchedulePostcode. Matched by
    /// value against ZipPolygon.Zip.</summary>
    public List<int> BoundPostcodes { get; set; } = new();
}

public record PostcodesForScheduleResponse(
    List<int> BoundZipPolygonIds,
    List<int> ZoneDerivedZipPolygonIds);
