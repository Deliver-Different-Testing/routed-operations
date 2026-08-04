using System.Globalization;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkPolygon;
using RoutedOperations.Core.Domain;
using Serilog;

namespace RoutedOperations.Core.Application.Services.BulkPolygon;

/// <summary>
/// CRUD for operator-drawn coverage polygons (Stage 3 - Polygon Builder).
/// Storage:
///   parent -> dbo.tblBulkRunPolygon
///   points -> dbo.tblBulkRunPolygonPoint (one row per vertex, OrderIndex ascending)
///   route link -> dbo.tblBulkRunPolygonRoute (M:N junction)
///
/// GeographyData on the parent is populated / kept-in-sync via raw SQL at
/// insert / reshape time. We assemble WKT client-side from the points list
/// (well-formed POLYGON string with the ring closed by repeating the first
/// vertex), then let SQL Server materialise a geography from it via
/// STGeomFromText + MakeValid + orientation-fixup (see the SQL block in
/// CreateAsync). The frontend never sees the geography and never sees
/// WKT - it only sees the points list.
///
/// Write path uses the AsAsyncEnumerable / await-foreach-break dance around
/// SqlQueryRaw INSERT-OUTPUT because EF Core 8 refuses to compose LINQ
/// operators over an INSERT ... OUTPUT statement (learned in Stage 2 E2E).
/// </summary>
public class BulkPolygonService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IHttpContextAccessor httpContextAccessor)
    : BaseService(contextFactory)
{
    public async Task<List<BulkPolygonDto>> GetAllAsync()
    {
        var rows = await Context.BulkRunPolygons
            .AsNoTracking()
            .Where(p => p.Active)
            .OrderBy(p => p.Name)
            .Select(p => new
            {
                p.PolygonId,
                p.Name,
                p.SourceType,
                p.SourceCode,
                p.CentroidLatitude,
                p.CentroidLongitude,
                p.Active,
                p.PartiallyIncludedZips,
                p.CreatedUtc,
                p.CreatedBy,
                p.LastModifiedUtc,
                p.UpdatedBy,
                AttachedRouteCount = p.Routes.Count(r => r.Active),
                Points = p.Points
                    .OrderBy(pt => pt.OrderIndex)
                    .Select(pt => new PolygonPointDto(pt.OrderIndex, pt.Lat, pt.Lng))
                    .ToList(),
            })
            .ToListAsync();

        return rows.Select(r => new BulkPolygonDto(
            r.PolygonId, r.Name, r.SourceType, r.SourceCode,
            r.CentroidLatitude, r.CentroidLongitude, r.Active,
            r.Points, r.AttachedRouteCount, r.PartiallyIncludedZips,
            r.CreatedUtc, r.CreatedBy, r.LastModifiedUtc, r.UpdatedBy)).ToList();
    }

    public async Task<BulkPolygonDto?> GetByIdAsync(int id)
    {
        var row = await Context.BulkRunPolygons
            .AsNoTracking()
            .Where(p => p.PolygonId == id)
            .Select(p => new
            {
                p.PolygonId,
                p.Name,
                p.SourceType,
                p.SourceCode,
                p.CentroidLatitude,
                p.CentroidLongitude,
                p.Active,
                p.PartiallyIncludedZips,
                p.CreatedUtc,
                p.CreatedBy,
                p.LastModifiedUtc,
                p.UpdatedBy,
                AttachedRouteCount = p.Routes.Count(r => r.Active),
                Points = p.Points
                    .OrderBy(pt => pt.OrderIndex)
                    .Select(pt => new PolygonPointDto(pt.OrderIndex, pt.Lat, pt.Lng))
                    .ToList(),
            })
            .FirstOrDefaultAsync();

        return row is null ? null : new BulkPolygonDto(
            row.PolygonId, row.Name, row.SourceType, row.SourceCode,
            row.CentroidLatitude, row.CentroidLongitude, row.Active,
            row.Points, row.AttachedRouteCount, row.PartiallyIncludedZips,
            row.CreatedUtc, row.CreatedBy, row.LastModifiedUtc, row.UpdatedBy);
    }

    public async Task<BulkPolygonDto> CreateAsync(CreateBulkPolygonRequest req)
    {
        ValidateName(req.Name);
        ValidatePoints(req.Points);
        var createdBy = CurrentUser();
        var wkt = BuildPolygonWkt(req.Points);

        // Insert parent + compute GeographyData in one round-trip so a
        // malformed / self-intersecting ring surfaces atomically (no
        // orphan parent row). MakeValid handles self-intersection;
        // EnvelopeAngle > 90 signals an inverted ring and we ReorientObject
        // (Google Maps click order is CW-in-map-coords which SQL Server
        // reads as "interior = everything outside the shape").
        int newId;
        try
        {
            var stream = Context.Database
                .SqlQueryRaw<int>(
                    """
                    DECLARE @Geog geography = geography::STGeomFromText(@wkt, 4326).MakeValid();
                    IF @Geog.EnvelopeAngle() > 90 SET @Geog = @Geog.ReorientObject();
                    INSERT INTO dbo.tblBulkRunPolygon
                        (Name, SourceType, SourceCode,
                         CentroidLatitude, CentroidLongitude,
                         GeographyData, Active,
                         CreatedUtc, CreatedBy)
                    OUTPUT INSERTED.PolygonId AS Value
                    VALUES
                        (@name, @sourceType, @sourceCode,
                         @lat, @lng,
                         @Geog, 1,
                         GETUTCDATE(), @createdBy);
                    """,
                    new SqlParameter("@name", req.Name.Trim()),
                    new SqlParameter("@sourceType", req.SourceType),
                    new SqlParameter("@sourceCode",
                        (object?)req.SourceCode?.Trim() ?? DBNull.Value),
                    new SqlParameter("@lat", req.CentroidLatitude),
                    new SqlParameter("@lng", req.CentroidLongitude),
                    new SqlParameter("@wkt", wkt),
                    new SqlParameter("@createdBy", createdBy))
                .AsAsyncEnumerable();

            newId = 0;
            await foreach (var id in stream) { newId = id; break; }
            if (newId == 0)
                throw new InvalidOperationException("BulkRunPolygon insert did not return an id.");
        }
        catch (SqlException ex)
        {
            throw new InvalidOperationException(
                $"Bulk polygon insert rejected by SQL Server (likely an invalid geometry): {ex.Message}", ex);
        }

        await InsertPointsAsync(newId, req.Points);
        await RefreshPartiallyIncludedZipsAsync(newId);

        Log.Information(
            "BulkRunPolygon {Id} ({Name}) created; source={Src}, code={Code}, points={PointCount}",
            newId, req.Name, req.SourceType, req.SourceCode ?? "(null)", req.Points.Count);
        return (await GetByIdAsync(newId))!;
    }

    public async Task<BulkPolygonDto?> UpdateShapeAsync(int id, UpdateBulkPolygonShapeRequest req)
    {
        ValidatePoints(req.Points);
        var updatedBy = CurrentUser();
        var wkt = BuildPolygonWkt(req.Points);

        int rows;
        try
        {
            rows = await Context.Database.ExecuteSqlRawAsync(
                """
                DECLARE @Geog geography = geography::STGeomFromText(@wkt, 4326).MakeValid();
                IF @Geog.EnvelopeAngle() > 90 SET @Geog = @Geog.ReorientObject();
                UPDATE dbo.tblBulkRunPolygon
                   SET GeographyData     = @Geog,
                       CentroidLatitude  = @lat,
                       CentroidLongitude = @lng,
                       LastModifiedUtc   = GETUTCDATE(),
                       UpdatedBy         = @updatedBy
                 WHERE PolygonId = @id
                   AND Active = 1;
                """,
                new SqlParameter("@wkt", wkt),
                new SqlParameter("@lat", req.CentroidLatitude),
                new SqlParameter("@lng", req.CentroidLongitude),
                new SqlParameter("@updatedBy", updatedBy),
                new SqlParameter("@id", id));
        }
        catch (SqlException ex)
        {
            throw new InvalidOperationException(
                $"Bulk polygon reshape rejected by SQL Server (likely an invalid geometry): {ex.Message}", ex);
        }
        if (rows == 0) return null;

        // Replace the child points wholesale. Two-statement swap so no
        // stale rows survive; runs in a single implicit transaction on
        // most connection defaults but is idempotent under retries.
        await Context.Database.ExecuteSqlRawAsync(
            "DELETE FROM dbo.tblBulkRunPolygonPoint WHERE PolygonId = @id;",
            new SqlParameter("@id", id));
        await InsertPointsAsync(id, req.Points);
        await RefreshPartiallyIncludedZipsAsync(id);

        Log.Information("BulkRunPolygon {Id} shape updated ({PointCount} points)", id, req.Points.Count);
        return await GetByIdAsync(id);
    }

    public async Task<BulkPolygonDto?> UpdateMetaAsync(int id, UpdateBulkPolygonMetaRequest req)
    {
        ValidateName(req.Name);
        var row = await Context.BulkRunPolygons.FirstOrDefaultAsync(p =>
            p.PolygonId == id && p.Active);
        if (row is null) return null;

        row.Name = req.Name.Trim();
        row.LastModifiedUtc = DateTime.UtcNow;
        row.UpdatedBy = CurrentUser();
        await Context.SaveChangesAsync();
        Log.Information("BulkRunPolygon {Id} renamed to {Name}", id, row.Name);
        return await GetByIdAsync(id);
    }

    /// <summary>Soft delete. Junction rows survive (Active=0 filter on the resolver's join hides them).</summary>
    public async Task<bool> SoftDeleteAsync(int id)
    {
        var row = await Context.BulkRunPolygons.FindAsync(id);
        if (row is null || !row.Active) return false;
        row.Active = false;
        row.LastModifiedUtc = DateTime.UtcNow;
        row.UpdatedBy = CurrentUser();
        await Context.SaveChangesAsync();
        Log.Information("BulkRunPolygon {Id} soft-deleted", id);
        return true;
    }

    // ─── HELPERS ───────────────────────────────────────────────────────────

    private async Task InsertPointsAsync(int polygonId, List<PolygonPointDto> points)
    {
        // Small batches (< 1k vertices in normal use) - individual INSERTs
        // are simpler than table-valued params and adequate at this volume.
        // Wrapped in a single ExecuteSqlRaw per point so parameterisation
        // is safe. Order preserved by OrderIndex column.
        foreach (var pt in points.OrderBy(p => p.OrderIndex))
        {
            await Context.Database.ExecuteSqlRawAsync(
                "INSERT INTO dbo.tblBulkRunPolygonPoint (PolygonId, OrderIndex, Lat, Lng) VALUES (@pid, @oi, @lat, @lng);",
                new SqlParameter("@pid", polygonId),
                new SqlParameter("@oi", pt.OrderIndex),
                new SqlParameter("@lat", pt.Lat),
                new SqlParameter("@lng", pt.Lng));
        }
    }

    /// <summary>Overlay the polygon's stored geography against dbo.ZipPolygon
    /// and persist the intersecting zip list into PartiallyIncludedZips.
    /// Storage format: leading + trailing commas so
    /// UTL_stpRouteAutoAssign_ResolveOneSide can match by
    /// `LIKE '%,<zip>,%'` without prefix-collision (1234 vs 12345).
    /// Called after Create + Reshape - runs one round-trip so the caller
    /// pays for the overlay only when the geometry actually changed.
    /// Silently no-ops when the shape overlaps zero ZipPolygon rows
    /// (column left NULL).</summary>
    private async Task RefreshPartiallyIncludedZipsAsync(int polygonId)
    {
        var zips = new List<string>();
        try
        {
            var stream = Context.Database
                .SqlQueryRaw<string>(
                    """
                    SELECT DISTINCT zp.Zip AS Value
                    FROM dbo.ZipPolygon zp
                    WHERE zp.GeographyData IS NOT NULL
                      AND zp.Zip IS NOT NULL
                      AND zp.GeographyData.STIntersects(
                            (SELECT p.GeographyData
                             FROM dbo.tblBulkRunPolygon p
                             WHERE p.PolygonId = @id)
                          ) = 1
                    """,
                    new SqlParameter("@id", polygonId))
                .AsAsyncEnumerable();
            await foreach (var z in stream)
            {
                if (!string.IsNullOrWhiteSpace(z)) zips.Add(z.Trim());
            }
        }
        catch (SqlException ex)
        {
            // Overlay failed (rare - typically a malformed source shape).
            // Log and leave the column untouched. Resolver falls through
            // to spatial-only pass when the pre-filter column is NULL.
            Log.Warning(ex,
                "PartiallyIncludedZips overlay failed for BulkRunPolygon {Id}; leaving column untouched",
                polygonId);
            return;
        }

        var packed = zips.Count == 0
            ? null
            : "," + string.Join(",",
                zips.Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(z => z, StringComparer.Ordinal))
              + ",";

        await Context.Database.ExecuteSqlRawAsync(
            "UPDATE dbo.tblBulkRunPolygon SET PartiallyIncludedZips = @z WHERE PolygonId = @id",
            new SqlParameter("@z", (object?)packed ?? DBNull.Value),
            new SqlParameter("@id", polygonId));

        Log.Information(
            "BulkRunPolygon {Id} PartiallyIncludedZips refreshed - {ZipCount} zip(s)",
            polygonId, zips.Count);
    }

    private static void ValidateName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Bulk polygon name is required.");
        if (name.Trim().Length > 200)
            throw new InvalidOperationException("Bulk polygon name is limited to 200 characters.");
    }

    private static void ValidatePoints(List<PolygonPointDto> points)
    {
        if (points is null || points.Count < 3)
            throw new InvalidOperationException("A polygon needs at least 3 vertices.");
    }

    /// <summary>Assemble a WKT POLYGON string from a points list, auto-closing the ring.</summary>
    private static string BuildPolygonWkt(List<PolygonPointDto> points)
    {
        var ordered = points.OrderBy(p => p.OrderIndex).ToList();
        var sb = new StringBuilder("POLYGON((");
        var inv = CultureInfo.InvariantCulture;
        for (int i = 0; i < ordered.Count; i++)
        {
            if (i > 0) sb.Append(", ");
            sb.Append(ordered[i].Lng.ToString(inv)).Append(' ').Append(ordered[i].Lat.ToString(inv));
        }
        // Close the ring by repeating the first vertex if it isn't already the last.
        var first = ordered[0];
        var last = ordered[^1];
        if (first.Lat != last.Lat || first.Lng != last.Lng)
        {
            sb.Append(", ").Append(first.Lng.ToString(inv)).Append(' ').Append(first.Lat.ToString(inv));
        }
        sb.Append("))");
        return sb.ToString();
    }

    private string CurrentUser()
    {
        var user = httpContextAccessor.HttpContext?.User;
        return user?.FindFirstValue(ClaimTypes.Email)
            ?? user?.FindFirstValue(ClaimTypes.Name)
            ?? "system";
    }
}
