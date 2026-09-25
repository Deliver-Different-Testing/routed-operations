using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Quote;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Quote;

/// <summary>
/// Quoting module (Stage 2 - C.3). Shadow-table CRUD + a first-pass
/// simulation engine that estimates cost / margin / recommended quote for
/// an uploaded job set. Never touches the live operational tables.
/// </summary>
public class QuoteService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    public async Task<List<QuoteSetSummary>> GetSetsAsync()
    {
        // EF Core 10 can't translate a positional-record ctor inside a
        // GroupBy projection - fall back to an anonymous type and rebuild
        // the record after the round-trip.
        var groups = await Context.TblQuoteJobs
            .AsNoTracking()
            .GroupBy(j => j.QuoteSetCode)
            .Select(g => new
            {
                QuoteSetCode = g.Key,
                Count = g.Count(),
                LastUploaded = g.Max(x => (DateTime?)x.CreatedUtc),
            })
            .ToListAsync();
        return groups
            .OrderByDescending(g => g.LastUploaded)
            .Select(g => new QuoteSetSummary(g.QuoteSetCode, g.Count, g.LastUploaded))
            .ToList();
    }

    public async Task<QuoteUploadResult> UploadAsync(QuoteUploadRequest req)
    {
        var rows = req.Rows.Select(r => new TblQuoteJob
        {
            QuoteSetCode = req.QuoteSetCode,
            Customer = r.Customer,
            FromAddress = r.FromAddress,
            ToAddress = r.ToAddress,
            FromPostCode = r.FromPostCode,
            ToPostCode = r.ToPostCode,
            WeightKg = r.WeightKg,
            WindowStart = r.WindowStart,
            WindowEnd = r.WindowEnd,
            IsPickup = r.IsPickup,
            CreatedUtc = DateTime.UtcNow,
        }).ToList();

        Context.TblQuoteJobs.AddRange(rows);
        await Context.SaveChangesAsync();

        Log.Information("Uploaded {Count} quote jobs into set {Set}",
            rows.Count, req.QuoteSetCode);
        return new QuoteUploadResult(req.QuoteSetCode, rows.Count);
    }

    public async Task<int> DeleteSetAsync(string quoteSetCode)
    {
        var rows = await Context.TblQuoteJobs
            .Where(j => j.QuoteSetCode == quoteSetCode)
            .ToListAsync();
        if (rows.Count == 0) return 0;
        Context.TblQuoteJobs.RemoveRange(rows);
        await Context.SaveChangesAsync();
        Log.Information("Deleted quote set {Set} ({Count} rows)", quoteSetCode, rows.Count);
        return rows.Count;
    }

    /// <summary>
    /// First-pass simulation. Groups jobs by zip, estimates drivers needed
    /// based on MaxStopsPerRun, applies a simple cost model. Real engine
    /// will bind to HERE distance matrix + tenant rate cards; this shape
    /// keeps the operator surface stable in the meantime.
    /// </summary>
    public async Task<QuoteSimulateResult> SimulateAsync(QuoteSimulateRequest req)
    {
        var jobCount = await Context.TblQuoteJobs
            .CountAsync(j => j.QuoteSetCode == req.QuoteSetCode);

        var maxStops = Math.Max(1, req.MaxStopsPerRun);
        var drivers = jobCount == 0 ? 0 : (int)Math.Ceiling(jobCount / (double)maxStops);

        // Rate-card knob: crude tiered baseline until real cards land.
        var (costPerJob, costPerKm, marginPct) = req.RateCard.ToLowerInvariant() switch
        {
            "premium"  => (18.50m, 1.60m, 28m),
            "standard" => (12.50m, 1.20m, 22m),
            "budget"   => (9.75m,  0.95m, 17m),
            _ => (12.50m, 1.20m, 22m),
        };
        // Service-level multiplier stacked on top.
        var serviceMul = req.ServiceLevel.ToLowerInvariant() switch
        {
            "same-day" => 1.25m,
            "express"  => 1.15m,
            _ => 1.0m,
        };

        var avgShift = 8.5;
        var estimatedKm = (decimal)jobCount * 3.8m;
        var totalCost = ((decimal)jobCount * costPerJob + estimatedKm * costPerKm) * serviceMul;
        var quote = totalCost * (1 + marginPct / 100m);

        Log.Information("Simulated quote {Set}: {Jobs} jobs, {Drivers} drivers, {RateCard}/{Service} -> ${Quote:F2}",
            req.QuoteSetCode, jobCount, drivers, req.RateCard, req.ServiceLevel, quote);

        return new QuoteSimulateResult(
            req.QuoteSetCode,
            jobCount,
            drivers,
            avgShift,
            costPerJob * serviceMul,
            costPerKm,
            Math.Round(totalCost, 2),
            marginPct,
            Math.Round(quote, 2));
    }
}
