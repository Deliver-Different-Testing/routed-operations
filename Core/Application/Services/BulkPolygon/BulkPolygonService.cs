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
        // Schedule-name bindings via tblSchedulePolygon (Phase-8 junction).
        // Small table - one dictionary lookup is cheaper than a per-row
        // subquery and lets the projection stay as EF-translatable as
        // possible.
        var scheduleBindings = await Context.SchedulePolygons.AsNoTracking()
            .GroupBy(x => x.PolygonId)
            .Select(g => new { PolygonId = g.Key, Names = g.Select(x => x.ScheduleName).ToList() })
            .ToDictionaryAsync(x => x.PolygonId, x => x.Names);

        // Zone / postcode-group name lookups so the sidebar chip can render
        // "zone Fleet" instead of "zone #17". Both reference tables are tiny
        // (dozens - low hundreds per tenant) - one dictionary fetch beats a
        // per-row join and keeps the main projection EF-translatable.
        var zoneNames = await Context.ZoneNames.AsNoTracking()
            .Select(z => new { z.ZoneNameId, z.ZoneName1 })
            .ToDictionaryAsync(z => z.ZoneNameId, z => z.ZoneName1);
        var groupNames = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .Select(g => new { g.Id, g.Name })
            .ToDictionaryAsync(g => g.Id, g => g.Name);

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
                p.ZoneNameId,
                p.PostcodeGroupId,
                AttachedRouteCount = p.Routes.Count(r => r.Active),
                AttachedRoutes = p.Routes
                    .Where(r => r.Active)
                    .OrderBy(r => r.Name)
                    .Select(r => new BulkPolygonAttachedRouteDto(r.RouteId, r.Name ?? string.Empty))
                    .ToList(),
                Points = p.Points
                    .OrderBy(pt => pt.RingIndex).ThenBy(pt => pt.OrderIndex)
                    .Select(pt => new PolygonPointDto(pt.RingIndex, pt.OrderIndex, pt.Lat, pt.Lng))
                    .ToList(),
            })
            .ToListAsync();

        return rows.Select(r => new BulkPolygonDto(
            r.PolygonId, r.Name, r.SourceType, r.SourceCode,
            r.CentroidLatitude, r.CentroidLongitude, r.Active,
            r.Points, r.AttachedRouteCount, r.AttachedRoutes,
            r.PartiallyIncludedZips,
            r.CreatedUtc, r.CreatedBy, r.LastModifiedUtc, r.UpdatedBy,
            r.ZoneNameId, r.PostcodeGroupId,
            scheduleBindings.TryGetValue(r.PolygonId, out var names) ? names : new List<string>(),
            r.ZoneNameId is int zid && zoneNames.TryGetValue(zid, out var zName) ? zName : null,
            r.PostcodeGroupId is int gid && groupNames.TryGetValue(gid, out var gName) ? gName : null)).ToList();
    }

    public async Task<BulkPolygonDto?> GetByIdAsync(int id)
    {
        var scheduleNames = await Context.SchedulePolygons.AsNoTracking()
            .Where(x => x.PolygonId == id)
            .Select(x => x.ScheduleName)
            .ToListAsync();

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
                p.ZoneNameId,
                p.PostcodeGroupId,
                AttachedRouteCount = p.Routes.Count(r => r.Active),
                AttachedRoutes = p.Routes
                    .Where(r => r.Active)
                    .OrderBy(r => r.Name)
                    .Select(r => new BulkPolygonAttachedRouteDto(r.RouteId, r.Name ?? string.Empty))
                    .ToList(),
                Points = p.Points
                    .OrderBy(pt => pt.RingIndex).ThenBy(pt => pt.OrderIndex)
                    .Select(pt => new PolygonPointDto(pt.RingIndex, pt.OrderIndex, pt.Lat, pt.Lng))
                    .ToList(),
            })
            .FirstOrDefaultAsync();

        if (row is null) return null;
        // Single-row hydration for the two name lookups. Cheap - one 1-row
        // query each when the binding exists, skipped when it doesn't.
        string? zoneName = null;
        if (row.ZoneNameId is int zid)
        {
            zoneName = await Context.ZoneNames.AsNoTracking()
                .Where(z => z.ZoneNameId == zid).Select(z => z.ZoneName1).FirstOrDefaultAsync();
        }
        string? groupName = null;
        if (row.PostcodeGroupId is int gid)
        {
            groupName = await Context.BulkZonePostcodeGroups.AsNoTracking()
                .Where(g => g.Id == gid).Select(g => g.Name).FirstOrDefaultAsync();
        }
        return new BulkPolygonDto(
            row.PolygonId, row.Name, row.SourceType, row.SourceCode,
            row.CentroidLatitude, row.CentroidLongitude, row.Active,
            row.Points, row.AttachedRouteCount, row.AttachedRoutes,
            row.PartiallyIncludedZips,
            row.CreatedUtc, row.CreatedBy, row.LastModifiedUtc, row.UpdatedBy,
            row.ZoneNameId, row.PostcodeGroupId, scheduleNames,
            zoneName, groupName);
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
        // is safe. Order preserved by (RingIndex, OrderIndex) column pair.
        foreach (var pt in points.OrderBy(p => p.RingIndex).ThenBy(p => p.OrderIndex))
        {
            await Context.Database.ExecuteSqlRawAsync(
                "INSERT INTO dbo.tblBulkRunPolygonPoint (PolygonId, RingIndex, OrderIndex, Lat, Lng) VALUES (@pid, @ri, @oi, @lat, @lng);",
                new SqlParameter("@pid", polygonId),
                new SqlParameter("@ri", pt.RingIndex),
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
            // Include a zip in the derived list only when it MEANINGFULLY
            // overlaps the polygon - i.e. the intersection area is at least
            // 10% of that zip's own area OR the polygon completely engulfs
            // the zip. Bare STIntersects was too permissive: neighbouring
            // zips share edges cleanly at their borders, so unioning two
            // adjacent zips (e.g. 94575 + 94556) produced a polygon whose
            // boundary touched EVERY neighbour, and every neighbour got
            // listed as "partially included" even though 0 area actually
            // fell inside. Under the resolver's zip-pre-filter this meant
            // false-positive candidate shapes and unnecessary STIntersects
            // work at booking time. The 10% threshold aligns
            // "partially included" with operator intuition ("this zip is
            // meaningfully covered by the polygon"). Fully-contained zips
            // are always included via the STWithin short-circuit.
            var stream = Context.Database
                .SqlQueryRaw<string>(
                    """
                    DECLARE @Poly geography =
                        (SELECT p.GeographyData FROM dbo.tblBulkRunPolygon p
                         WHERE p.PolygonId = @id);
                    SELECT DISTINCT zp.Zip AS Value
                    FROM dbo.ZipPolygon zp
                    WHERE zp.GeographyData IS NOT NULL
                      AND zp.Zip IS NOT NULL
                      AND zp.GeographyData.STIntersects(@Poly) = 1
                      AND (
                            -- Zip is fully engulfed by the polygon (fast path,
                            -- avoids STIntersection cost when clearly inside).
                            zp.GeographyData.STWithin(@Poly) = 1
                         OR -- Or the actual overlap area is >= 10% of the
                            -- zip's total area. Excludes edge-only touches
                            -- (intersection area = 0) and sliver overlaps
                            -- caused by ZIP-boundary noise.
                            zp.GeographyData.STIntersection(@Poly).STArea()
                              >= 0.1 * zp.GeographyData.STArea()
                          )
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

    /// <summary>Assemble a WKT string from a points list, auto-closing every
    /// ring. Handles the full range:
    ///   - Single ring       -> POLYGON((...))
    ///   - Outer + holes     -> POLYGON((outer), (hole1), (hole2))
    ///   - Multi-piece union -> MULTIPOLYGON(((piece1)), ((piece2 outer), (piece2 hole)))
    ///
    /// Piece boundaries are inferred from ring winding order: a CCW ring
    /// starts a new piece (outer); subsequent CW rings attach as holes to
    /// the current piece; the next CCW starts the next piece. This mirrors
    /// Google Maps' Polygon.setPaths() interpretation, so the frontend and
    /// backend agree without an explicit "is this a hole" flag on each
    /// point row.
    ///
    /// SQL Server's `.MakeValid()` + `.ReorientObject()` normalise the
    /// final geography so a slightly wrong ordering still produces a
    /// valid geography (albeit possibly with pieces merged or holes
    /// dropped). Winding is computed via signed area (shoelace formula).</summary>
    private static string BuildPolygonWkt(List<PolygonPointDto> points)
    {
        // Group points by ring, preserving ring order.
        var ringsInOrder = points
            .GroupBy(p => p.RingIndex)
            .OrderBy(g => g.Key)
            .Select(g => g.OrderBy(p => p.OrderIndex).ToList())
            .Where(r => r.Count >= 3)
            .ToList();

        if (ringsInOrder.Count == 0)
            throw new InvalidOperationException("BuildPolygonWkt: no rings with >= 3 vertices.");

        // Group rings into pieces. First ring starts piece 0 as its outer;
        // subsequent CCW rings start new pieces; CW rings attach as holes
        // to the current piece.
        var pieces = new List<List<List<PolygonPointDto>>>();
        foreach (var ring in ringsInOrder)
        {
            var isCcw = SignedRingArea(ring) > 0;
            if (pieces.Count == 0 || isCcw)
                pieces.Add(new List<List<PolygonPointDto>> { ring });
            else
                pieces[^1].Add(ring); // CW ring - hole of the current piece.
        }

        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        var isMulti = pieces.Count > 1;

        // Local helper: append one ring's coordinate sequence as `(x y, x y, ...)`,
        // auto-closing if the ring doesn't already close.
        void AppendRing(List<PolygonPointDto> ring)
        {
            sb.Append('(');
            for (int i = 0; i < ring.Count; i++)
            {
                if (i > 0) sb.Append(", ");
                sb.Append(ring[i].Lng.ToString(inv)).Append(' ').Append(ring[i].Lat.ToString(inv));
            }
            var first = ring[0];
            var last = ring[^1];
            if (first.Lat != last.Lat || first.Lng != last.Lng)
                sb.Append(", ").Append(first.Lng.ToString(inv)).Append(' ').Append(first.Lat.ToString(inv));
            sb.Append(')');
        }

        if (isMulti)
        {
            // MULTIPOLYGON(((outer), (hole)), ((outer2)))
            sb.Append("MULTIPOLYGON(");
            for (int p = 0; p < pieces.Count; p++)
            {
                if (p > 0) sb.Append(", ");
                sb.Append('(');
                var piece = pieces[p];
                for (int r = 0; r < piece.Count; r++)
                {
                    if (r > 0) sb.Append(", ");
                    AppendRing(piece[r]);
                }
                sb.Append(')');
            }
            sb.Append(')');
        }
        else
        {
            // POLYGON((outer), (hole1), (hole2))
            sb.Append("POLYGON(");
            var piece = pieces[0];
            for (int r = 0; r < piece.Count; r++)
            {
                if (r > 0) sb.Append(", ");
                AppendRing(piece[r]);
            }
            sb.Append(')');
        }
        return sb.ToString();
    }

    /// <summary>Shoelace signed area. Positive = CCW, negative = CW. Uses
    /// (lng, lat) as (x, y) - planar approximation is fine for winding
    /// detection at continental / city scale.</summary>
    private static double SignedRingArea(List<PolygonPointDto> ring)
    {
        double sum = 0;
        for (int i = 0; i < ring.Count; i++)
        {
            var a = ring[i];
            var b = ring[(i + 1) % ring.Count];
            sum += (b.Lng - a.Lng) * (b.Lat + a.Lat);
        }
        // Shoelace as written gives sign inverted for our y-up convention;
        // flip so positive = CCW.
        return -sum / 2.0;
    }

    private string CurrentUser()
    {
        var user = httpContextAccessor.HttpContext?.User;
        return user?.FindFirstValue(ClaimTypes.Email)
            ?? user?.FindFirstValue(ClaimTypes.Name)
            ?? "system";
    }
}
