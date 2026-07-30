using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.BulkPolygon;
using RoutedOperations.Core.Application.Services.BulkPolygon;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Operator-drawn coverage polygons (Stage 3 - Polygon Builder).
/// Storage: dbo.tblBulkRunPolygon + dbo.tblBulkRunPolygonPoint per Steve's
/// spec KEVIN-ZIP-POLYGON-TO-CUSTOM-COVERAGE-FLOW-2026-07-29. Participate
/// in prebook auto-assign via the point-in-polygon fallback in
/// UTL_stpRouteAutoAssign_ResolveOneSide when the zip-first pass returns
/// no candidates and the booking carries pickup coords.
/// </summary>
[ApiController]
[Route("api/bulk-polygons")]
[Authorize(Policy = "RouteBuilder.Read")]
public class BulkPolygonsController(BulkPolygonService svc) : BaseController
{
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var list = await svc.GetAllAsync();
        return Ok(new { response = list });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetOne(int id)
    {
        var row = await svc.GetByIdAsync(id);
        return row is null ? NotFound() : Ok(new { response = row });
    }

    [HttpPost]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Create([FromBody] CreateBulkPolygonRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var created = await svc.CreateAsync(req);
            return Ok(new { response = created });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id:int}/shape")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdateShape(int id, [FromBody] UpdateBulkPolygonShapeRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var updated = await svc.UpdateShapeAsync(id, req);
            return updated is null ? NotFound() : Ok(new { response = updated });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdateMeta(int id, [FromBody] UpdateBulkPolygonMetaRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var updated = await svc.UpdateMetaAsync(id, req);
            return updated is null ? NotFound() : Ok(new { response = updated });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var ok = await svc.SoftDeleteAsync(id);
        return ok ? Ok(new { response = "Deactivated" }) : NotFound();
    }
}
