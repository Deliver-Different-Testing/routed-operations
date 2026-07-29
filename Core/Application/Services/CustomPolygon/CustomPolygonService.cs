using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.CustomPolygon;
using RoutedOperations.Core.Domain;
using Serilog;

namespace RoutedOperations.Core.Application.Services.CustomPolygon;

/// <summary>
/// CRUD for operator-drawn custom polygons (Stage 2 RoutedOperations Polygon
/// Builder). Rows in dbo.CustomZipPolygon; junction to Routes via
/// dbo.RouteCustomZipPolygon. Participate in prebook auto-assign via the
/// point-in-polygon fallback in UTL_stpRouteAutoAssign_ResolveOneSide.
///
/// GeographyData is populated/updated via raw SQL inline
/// (geography::STGeomFromText(@wkt, 4326)) rather than through EF, so the
/// entity class doesn't need to know about the geography type at all.
/// WKT parse errors surface as SqlException on the write and are translated
/// to InvalidOperationException by the service caller.
/// </summary>
public class CustomPolygonService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IHttpContextAccessor httpContextAccessor)
    : BaseService(contextFactory)
{
    public async Task<List<CustomPolygonDto>> GetAllAsync()
    {
        var rows = await Context.CustomZipPolygons
            .AsNoTracking()
            .Where(z => z.Active)
            .OrderBy(z => z.Name)
            .Select(z => new
            {
                z.CustomZipPolygonId,
                z.Name,
                z.CentroidLatitude,
                z.CentroidLongitude,
                z.Wkt,
                z.Active,
                z.CreatedAt,
                z.UpdatedAt,
                AttachedRouteCount = z.Routes.Count(r => r.Active),
            })
            .ToListAsync();

        return rows.Select(r => new CustomPolygonDto(
            r.CustomZipPolygonId, r.Name, r.CentroidLatitude, r.CentroidLongitude,
            r.Wkt, r.Active, r.AttachedRouteCount, r.CreatedAt, r.UpdatedAt)).ToList();
    }

    public async Task<CustomPolygonDto?> GetByIdAsync(int id)
    {
        var row = await Context.CustomZipPolygons
            .AsNoTracking()
            .Where(z => z.CustomZipPolygonId == id)
            .Select(z => new
            {
                z.CustomZipPolygonId,
                z.Name,
                z.CentroidLatitude,
                z.CentroidLongitude,
                z.Wkt,
                z.Active,
                z.CreatedAt,
                z.UpdatedAt,
                AttachedRouteCount = z.Routes.Count(r => r.Active),
            })
            .FirstOrDefaultAsync();

        return row is null ? null : new CustomPolygonDto(
            row.CustomZipPolygonId, row.Name, row.CentroidLatitude, row.CentroidLongitude,
            row.Wkt, row.Active, row.AttachedRouteCount, row.CreatedAt, row.UpdatedAt);
    }

    public async Task<CustomPolygonDto> CreateAsync(CreateCustomPolygonRequest req)
    {
        ValidateName(req.Name);
        ValidateWkt(req.Wkt);
        var createdBy = CurrentUser();

        // Insert + geography compute in one round trip so a malformed WKT
        // fails atomically (no orphaned Wkt-only row). AsAsyncEnumerable
        // stops EF from trying to compose LINQ over an INSERT ... OUTPUT
        // (which isn't composable) - the "'FromSql' or 'SqlQuery' was
        // called with non-composable SQL" error.
        int newId;
        try
        {
            // Reorient rings so the polygon interior sits on the correct side.
            // SQL Server geography interprets ring orientation via the left-hand
            // rule; a clockwise-in-map-coords ring (which is what Google Maps
            // gives us by default from click order) yields a polygon that
            // "covers the whole earth minus this shape". EnvelopeAngle > 90
            // is the standard signal that the ring is inverted.
            var stream = Context.Database
                .SqlQueryRaw<int>(
                    """
                    DECLARE @Geog geography = geography::STGeomFromText(@wkt, 4326);
                    IF @Geog.EnvelopeAngle() > 90 SET @Geog = @Geog.ReorientObject();
                    INSERT INTO dbo.CustomZipPolygon
                        (Name, CentroidLatitude, CentroidLongitude, Wkt, GeographyData, Active, CreatedAt, CreatedBy)
                    OUTPUT INSERTED.CustomZipPolygonId AS Value
                    VALUES
                        (@name, @lat, @lng, @wkt, @Geog, 1, GETUTCDATE(), @createdBy);
                    """,
                    new SqlParameter("@name", req.Name.Trim()),
                    new SqlParameter("@lat", req.CentroidLatitude),
                    new SqlParameter("@lng", req.CentroidLongitude),
                    new SqlParameter("@wkt", req.Wkt),
                    new SqlParameter("@createdBy", createdBy))
                .AsAsyncEnumerable();

            newId = 0;
            await foreach (var id in stream) { newId = id; break; }
            if (newId == 0)
                throw new InvalidOperationException("Custom polygon insert did not return an id.");
        }
        catch (SqlException ex)
        {
            throw new InvalidOperationException(
                $"Custom polygon insert rejected by SQL Server (likely an invalid WKT string): {ex.Message}", ex);
        }

        Log.Information("CustomZipPolygon {Id} ({Name}) created", newId, req.Name);
        return (await GetByIdAsync(newId))!;
    }

    public async Task<CustomPolygonDto?> UpdateShapeAsync(int id, UpdateCustomPolygonShapeRequest req)
    {
        ValidateWkt(req.Wkt);
        var updatedBy = CurrentUser();

        int rows;
        try
        {
            // Same ring-orientation reorient as CreateAsync - see comment there.
            rows = await Context.Database.ExecuteSqlRawAsync(
                """
                DECLARE @Geog geography = geography::STGeomFromText(@wkt, 4326);
                IF @Geog.EnvelopeAngle() > 90 SET @Geog = @Geog.ReorientObject();
                UPDATE dbo.CustomZipPolygon
                   SET Wkt               = @wkt,
                       GeographyData     = @Geog,
                       CentroidLatitude  = @lat,
                       CentroidLongitude = @lng,
                       UpdatedAt         = GETUTCDATE(),
                       UpdatedBy         = @updatedBy
                 WHERE CustomZipPolygonId = @id
                   AND Active = 1
                """,
                new SqlParameter("@wkt", req.Wkt),
                new SqlParameter("@lat", req.CentroidLatitude),
                new SqlParameter("@lng", req.CentroidLongitude),
                new SqlParameter("@updatedBy", updatedBy),
                new SqlParameter("@id", id));
        }
        catch (SqlException ex)
        {
            throw new InvalidOperationException(
                $"Custom polygon reshape rejected by SQL Server (likely an invalid WKT string): {ex.Message}", ex);
        }

        if (rows == 0) return null;
        Log.Information("CustomZipPolygon {Id} shape updated", id);
        return await GetByIdAsync(id);
    }

    public async Task<CustomPolygonDto?> UpdateMetaAsync(int id, UpdateCustomPolygonMetaRequest req)
    {
        ValidateName(req.Name);
        var row = await Context.CustomZipPolygons.FirstOrDefaultAsync(z =>
            z.CustomZipPolygonId == id && z.Active);
        if (row is null) return null;

        row.Name = req.Name.Trim();
        row.UpdatedAt = DateTime.UtcNow;
        row.UpdatedBy = CurrentUser();
        await Context.SaveChangesAsync();
        Log.Information("CustomZipPolygon {Id} renamed to {Name}", id, row.Name);
        return await GetByIdAsync(id);
    }

    /// <summary>Soft delete. Junction rows survive for audit; resolver's Active=1 filter naturally excludes it.</summary>
    public async Task<bool> SoftDeleteAsync(int id)
    {
        var row = await Context.CustomZipPolygons.FindAsync(id);
        if (row is null || !row.Active) return false;
        row.Active = false;
        row.UpdatedAt = DateTime.UtcNow;
        row.UpdatedBy = CurrentUser();
        await Context.SaveChangesAsync();
        Log.Information("CustomZipPolygon {Id} soft-deleted", id);
        return true;
    }

    private static void ValidateName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Custom polygon name is required.");
        if (name.Trim().Length > 100)
            throw new InvalidOperationException("Custom polygon name is limited to 100 characters.");
    }

    private static void ValidateWkt(string wkt)
    {
        if (string.IsNullOrWhiteSpace(wkt))
            throw new InvalidOperationException("Custom polygon WKT is required.");
        // Cheap syntactic guard so an empty / obviously-broken string doesn't
        // even hit SQL Server. Real geometry validation happens on the write.
        var trimmed = wkt.TrimStart();
        if (!trimmed.StartsWith("POLYGON", StringComparison.OrdinalIgnoreCase) &&
            !trimmed.StartsWith("MULTIPOLYGON", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Custom polygon WKT must begin with POLYGON or MULTIPOLYGON.");
        }
    }

    private string CurrentUser()
    {
        var user = httpContextAccessor.HttpContext?.User;
        return user?.FindFirstValue(ClaimTypes.Email)
            ?? user?.FindFirstValue(ClaimTypes.Name)
            ?? "system";
    }
}
