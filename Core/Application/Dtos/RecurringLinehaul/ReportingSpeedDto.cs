namespace RoutedOperations.Core.Application.Dtos.RecurringLinehaul;

// Enriched speed shape used by the Linehaul edit modal's Speed dropdown +
// the Mapped Stops JobDetail modal's Speed picker. groupingName drives both
// the optgroup label and the SpeedChip colour rule.
public class ReportingSpeedDto
{
    public int Id { get; set; }
    public string ShortName { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int GroupingId { get; set; }
    public string? GroupingName { get; set; }
}

/// <summary>Which table a Mapped Stops row came from. Bug 3: a linehaul
/// leg's child job is written to one of two tables, so Id alone does not
/// identify a row and every id-addressed endpoint needs this alongside it.
///
/// - "bulk" dbo.tblBulkJob, key BulkJobId. Written when the leg has
///          InsertToBulk = 1.
/// - "tuc"  dbo.tucJob,     key ucjbID.    Written when the leg has
///          InsertToBulk = 0.
///
/// dbo.tucJobArchive is deliberately NOT a source. sp_JobArchive only moves
/// rows that are void or finished:
///
///     WHERE ( tucJob.ucjbVoid = 1
///          OR ( tucJob.ucjbJobDone = 1 AND tucJob.ucjbStatus IN (6, 10, 13)
///               AND (Reprice = 0 OR Reprice IS NULL) ) )
///
/// so the archive holds completed work only, which Mapped Stops has no use
/// for (void rows were already filtered out of this list anyway). Leaving it
/// out also keeps 19,011 rows on urgent-prod out of the union's sort input.
/// Kevin's call 2026-09-30.
///
/// Values are lowercase and travel over the wire as-is; the frontend type is
/// the same two-member union.</summary>
public static class JobSources
{
    public const string Bulk = "bulk";
    public const string Tuc = "tuc";

    /// <summary>Normalises a query-string value. Anything unrecognised, including
    /// null and empty, resolves to Bulk so a client written before Bug 3 keeps
    /// addressing tblBulkJob exactly as it did.</summary>
    public static string Normalise(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        Tuc => Tuc,
        _ => Bulk,
    };
}

// Row summary for the Mapped Stops drill-down list.
public class BulkJobListItemDto
{
    public int Id { get; set; }

    /// <summary>Which table Id belongs to. See <see cref="JobSources"/>.
    /// Must be sent back on any request that addresses this row.</summary>
    public string Source { get; set; } = JobSources.Bulk;
    public string JobNumber { get; set; } = string.Empty;
    public string? Pickup { get; set; }
    public string? Drop { get; set; }
    public int SpeedId { get; set; }
    public string SpeedShortName { get; set; } = string.Empty;
    public string SpeedName { get; set; } = string.Empty;
    public int? SpeedGroupingId { get; set; }
    public string? SpeedGroupingName { get; set; }
    public string? BookDate { get; set; }
    public string? BookTime { get; set; }
    public string? StatusName { get; set; }
}

/// <summary>One page of Mapped Stops rows. Same shape as
/// RouteAutoAssignLogPageDto so the frontend paging pattern is the familiar one.
///
/// Paged because the list is genuinely large: on urgent-prod 2026-09-30 the
/// biggest run resolves to 9,274 non-void stops across the two sources, and
/// 9,239 of those were already being rendered in full by the un-paged
/// version.</summary>
public record BulkJobPageDto(
    int Total,
    int Page,
    int PageSize,
    List<BulkJobListItemDto> Entries);

// Full detail returned by GET /api/recurring-jobs/{jobId} + the response to
// PATCH /api/recurring-jobs/{jobId}/speed.
public class BulkJobDetailDto
{
    public int Id { get; set; }

    /// <summary>Which table Id belongs to. See <see cref="JobSources"/>.</summary>
    public string Source { get; set; } = JobSources.Bulk;
    public string JobNumber { get; set; } = string.Empty;
    public string Customer { get; set; } = string.Empty;
    public string StatusName { get; set; } = string.Empty;
    public string PickupAddress { get; set; } = string.Empty;
    public string DropAddress { get; set; } = string.Empty;
    public string? BookDate { get; set; }
    public string? BookTime { get; set; }
    public string? LinehaulRunName { get; set; }
    public int SpeedId { get; set; }
    public string SpeedShortName { get; set; } = string.Empty;
    public string SpeedName { get; set; } = string.Empty;
    public int? SpeedGroupingId { get; set; }
    public string? SpeedGroupingName { get; set; }
    public bool SpeedEditable { get; set; }
    public string? Notes { get; set; }
}

public class BulkJobUpdateSpeedRequest
{
    public int SpeedId { get; set; }
}
