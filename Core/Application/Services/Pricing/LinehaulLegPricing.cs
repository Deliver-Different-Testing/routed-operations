using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.Pricing;

/// <summary>
/// UC #1115 M3. How one linehaul leg is priced, in one place, so Bulk Import's
/// per-leg split (BulkImportRatingService.InsertLinehaulJobs) cannot drift
/// from the SQL.
///
/// Mirrors dbmigrationsv2:
///   20261126200000_LinehaulLegAmountOrZonePercent.sql, fncT_BulkZoneRate_WithLinehaul
///     run rate lookup lines 340-351, D2 rule line 369, MFV / PPD / ApplyDiscount
///     lines 365-373, additional item factor lines 378-381, leg total lines 384-403,
///     additional item percentage lines 116 and 209-214.
///   20261126200100_ScheduleChildLegsRunRateAndItemRate.sql, WS_ cursor lines 1858-1868
///     (same run rate lookup on job creation, J2), additional item percentage
///     lines 1655-1666.
/// </summary>
public static class LinehaulLegPricing
{
    /// <summary>
    /// UC1115 D2 default (open with Steve): a leg or run rate with Amount above 0
    /// is priced at Amount only; the zone % is used only when Amount is 0 / NULL.
    /// For the additive answer (Amount + zone base x %), set this to false; the SQL
    /// twin is 20261126200000 line 369. static readonly, not const, so
    /// the compiler does not flag the other branch as unreachable (CS0162).
    /// </summary>
    public static readonly bool AmountOnlyWhenBothSet = true;

    /// <summary>
    /// UC1115 J2 default (open with Steve): a BulkLinehaulRate row on the leg's run
    /// wins over the leg's own Amount / AmountPercentage. For "leg price on child
    /// jobs", set this to false; the SQL twin is 20261126200100 lines 741 / 1867.
    /// </summary>
    public static readonly bool RunRateWinsOverLeg = true;

    /// <summary>Multi-item default when neither client nor speed sets one (SPEC section 4).</summary>
    public const decimal DefaultAddOnPercentageFallback = 0.8M;

    /// <summary>
    /// The default additional item percentage: env var DefaultAddonPercentage when
    /// set (ops override per tenant), else 0.8. Moved from BulkImportRatingService.
    /// </summary>
    public static decimal DefaultAddOnPercentage()
    {
        var raw = Environment.GetEnvironmentVariable("DefaultAddonPercentage");
        if (!string.IsNullOrWhiteSpace(raw)
            && decimal.TryParse(raw, System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }
        return DefaultAddOnPercentageFallback;
    }

    /// <summary>The Amount / % a leg is priced from after the run rate rule (J2).</summary>
    public readonly record struct LegFigures(decimal? Amount, decimal? AmountPercentage, bool FromRunRate);

    /// <summary>
    /// J2. A run rate holds only one of Amount / % (CK_BulkLinehaulRate_OneOf), so
    /// the missing one is 0, as the SQL ISNULL(lr.Amount, 0) does.
    /// </summary>
    public static LegFigures ResolveFigures(decimal? legAmount, decimal? legPercentage, BulkLinehaulRate? runRate)
    {
        if (RunRateWinsOverLeg && runRate != null)
            return new LegFigures(runRate.Amount ?? 0M, runRate.AmountPercentage ?? 0M, true);
        return new LegFigures(legAmount, legPercentage, false);
    }

    /// <summary>
    /// D2. The raw single-item leg price before fuel, PPD and discount. Returns
    /// null when the price is a zone % and the zone base is not known (a schedule
    /// being edited has no job yet); the caller shows the % instead.
    /// </summary>
    public static decimal? RawLegPrice(LegFigures figures, decimal? zoneBase) =>
        RawLegPrice(figures, zoneBase, AmountOnlyWhenBothSet);

    /// <summary>RawLegPrice with the D2 switch passed in, so tests can price both answers.</summary>
    public static decimal? RawLegPrice(LegFigures figures, decimal? zoneBase, bool amountOnlyWhenBothSet)
    {
        var amount = figures.Amount ?? 0M;
        var pct = figures.AmountPercentage ?? 0M;
        if (amountOnlyWhenBothSet)
        {
            if (amount > 0) return Round2(amount);
            if (pct > 0) return zoneBase.HasValue ? Round2(zoneBase.Value * pct) : null;
            return 0M;
        }
        if (pct > 0 && !zoneBase.HasValue) return null;
        return Round2(amount + (pct > 0 ? zoneBase!.Value * pct : 0M));
    }

    /// <summary>"Apply client discount": divide by (1 + client Discount) when ticked and set.</summary>
    public static decimal DiscountDivisor(bool? applyDiscount, decimal? clientDiscount) =>
        applyDiscount == true && (clientDiscount ?? 0M) != 0M ? 1M + clientDiscount!.Value : 1M;

    /// <summary>
    /// Single-item leg price with fuel, PPD and the client discount, rounded the way
    /// the SQL does it (20261126200000 lines 365-373): ROUND(ROUND(raw * (1 + MFV), 2)
    /// / PPD divisor / discount divisor, 4). The SQL rounds away from zero.
    /// </summary>
    public static decimal SingleItemPrice(decimal rawPrice, decimal mfv, decimal ppdDivisor, decimal discountDivisor)
    {
        var withFuel = Round2(rawPrice * (1M + mfv));
        return Math.Round(withFuel / (ppdDivisor == 0M ? 1M : ppdDivisor) / discountDivisor, 4, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// "Discount additional items": each additional item pays the leg price x the
    /// additional item percentage when ticked, else x 1. NULL tick = off (D1).
    /// </summary>
    public static decimal AdditionalItemFactor(bool? applyAddOnPercentage, decimal addOnPercentage) =>
        applyAddOnPercentage == true ? addOnPercentage : 1M;

    /// <summary>
    /// Whole leg for a booking of <paramref name="quantity"/> items (SQL lines 384-403).
    /// The SQL holds the per-item add-on in a DECIMAL(18,4) before multiplying by
    /// (quantity - 1), so it is rounded to 4 dp here too.
    /// </summary>
    public static decimal LegTotal(decimal singleItemPrice, int quantity, decimal additionalItemFactor)
    {
        if (quantity <= 1) return Round2(singleItemPrice);
        var addOn = Math.Round(singleItemPrice * additionalItemFactor, 4, MidpointRounding.AwayFromZero);
        return Round2(singleItemPrice + addOn * (quantity - 1));
    }

    /// <summary>
    /// Run rate for a leg, same lookup and precedence as the SQL OUTER APPLY:
    /// active row on the leg's run, schedule-specific over generic, then client over
    /// default, then exact speed over any speed (ORDER BY ... DESC puts NULL last).
    /// </summary>
    public static BulkLinehaulRate? FindRunRate(DynamicDespatchDbContext context, int? linehaulRunId, int? scheduleId, int? clientId, int? speedId)
    {
        if (linehaulRunId == null) return null;
        return context.BulkLinehaulRates.AsNoTracking()
            .Where(r => r.LinehaulRunId == linehaulRunId && r.Active
                        && (r.ScheduleId == scheduleId || r.ScheduleId == null)
                        && (r.ClientId == clientId || r.ClientId == null)
                        && (r.SpeedId == speedId || r.SpeedId == null))
            .OrderByDescending(r => r.ScheduleId)
            .ThenByDescending(r => r.ClientId)
            .ThenByDescending(r => r.SpeedId)
            .FirstOrDefault();
    }

    /// <summary>
    /// Additional item percentage for ONE booking's client and speed, with the same
    /// precedence as the SQL that charges a linehaul leg (fncT 20261126200000 lines 116
    /// and 209-214, WS_ 20261126200100 lines 1655-1666): this client + this speed row
    /// (tblClientAvailableSpeed) when above 0, else the client's own when not 0 (above 1
    /// and below 0 included, as the SQL takes it), else the speed's when above 0, else
    /// the default. A speed that is NULL or has no tucJobType row leaves the SQL on the
    /// client step's 0, so 0 here too. Used only by the linehaul leg weights; the
    /// Bulk Import multi-item parent split keeps develop's own lookup (BulkImportServiceV2.ResolveAddOnPercentageLegacyBulkSplit).
    ///
    /// Known differences from the SQL, not reimplemented (no local NZ data hits them, 26 Nov):
    /// - Client + speed source: the SQL reads UTL_fncJob_GetClientAvailableSpeed, which
    ///   applies per-login visibility and the time window, falls back to the
    ///   tblClientDefault_AvailableSpeed 'API - Web Integration' template, and does not
    ///   filter UseSchedules. Here: tblClientAvailableSpeed rows with Active and
    ///   UseSchedules = 1 only, no template.
    /// - Several client + speed rows: the SQL keeps the last row assigned (no order);
    ///   here the first row above 0.
    /// - No tucClient row and no tucJobType row: the SQL ends with NULL (the leg add-on
    ///   becomes NULL); here 0.
    /// - Default: the DefaultAddonPercentage env var when set, where the SQL has a hard 0.8.
    /// </summary>
    public static decimal ResolveAddOnPercentage(DynamicDespatchDbContext context, int? clientId, int? speedId)
    {
        var clientAvailableSpeed = context.TblClientAvailableSpeeds
            .FirstOrDefault(s => s.ClientId == clientId && s.SpeedId == speedId && s.Active == true && s.UseSchedules == true && s.AddonPercentage > 0);
        if (clientAvailableSpeed != null)
            return clientAvailableSpeed.AddonPercentage!.Value;

        var clientAddon = context.TucClients
            .Where(c => c.UcclId == clientId)
            .Select(c => c.AddonPercentage)
            .FirstOrDefault();
        if (clientAddon.HasValue && clientAddon.Value != 0M) return clientAddon.Value;

        var speed = speedId.HasValue ? context.TucJobTypes.FirstOrDefault(s => s.UcjtId == speedId) : null;
        if (speed == null) return 0M;
        return speed.AddonPercentage > 0 ? speed.AddonPercentage.Value : DefaultAddOnPercentage();
    }

    private static decimal Round2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
}
