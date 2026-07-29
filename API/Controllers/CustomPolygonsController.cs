using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.CustomPolygon;
using RoutedOperations.Core.Application.Services.CustomPolygon;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Operator-drawn custom polygons (Stage 2 - Polygon Builder). Live in a
/// separate table (dbo.CustomZipPolygon) from the shipped-global ZipPolygon
/// reference data. Participate in prebook auto-assign via the point-in-
/// polygon fallback in UTL_stpRouteAutoAssign_ResolveOneSide.
/// </summary>
[ApiController]
[Route("api/custom-polygons")]
[Authorize(Policy = "RouteBuilder.Read")]
public class CustomPolygonsController(CustomPolygonService svc) : BaseController
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
    public async Task<IActionResult> Create([FromBody] CreateCustomPolygonRequest req)
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
    public async Task<IActionResult> UpdateShape(int id, [FromBody] UpdateCustomPolygonShapeRequest req)
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
    public async Task<IActionResult> UpdateMeta(int id, [FromBody] UpdateCustomPolygonMetaRequest req)
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
