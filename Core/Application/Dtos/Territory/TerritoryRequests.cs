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
