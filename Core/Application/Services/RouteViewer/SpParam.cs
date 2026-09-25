// Route Viewer SP-invocation helper. Wraps SqlParameter construction with
// the legacy-parity behaviour the master checklist Section 2 requires:
//
// - Empty string coerces to DBNull. Every legacy RVW_stp* SP with an IN-
//   clause branch (@ClientIds, @RegionIds, @SpeedIds, etc.) treats NULL
//   as "no filter"; a passed-through empty string would break the
//   STRING_SPLIT + IN pattern.
//
// - Nullable value types with no value coerce to DBNull too.
//
// - Otherwise a plain SqlParameter with the value.
//
// Used from every RouteViewer* service that composes a raw SP call via
// Context.Database.SqlQueryRaw<T>(...). Keeps call sites terse:
//
//   var rows = await Context.Database.SqlQueryRaw<BulkRunDto>(
//       "EXEC dbo.RVW_stpBulkRuns_2 @RunDate, @ClientIds, @NpAgentId, @TenantTimeZone",
//       SpParam.Of("@RunDate", request.RunDate),
//       SpParam.Of("@ClientIds", request.ClientIds),
//       SpParam.Of("@NpAgentId", scope.NpAgentId),
//       SpParam.Of("@TenantTimeZone", tenantTz))
//       .ToListAsync();
using Microsoft.Data.SqlClient;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public static class SpParam
{
    public static SqlParameter Of(string name, object? value)
    {
        // Empty string -> DBNull (matches legacy DespatchContextExtensions
        // coercion for IN-clause filter SPs).
        if (value is string s && s.Length == 0)
        {
            return new SqlParameter(name, DBNull.Value);
        }
        return new SqlParameter(name, value ?? DBNull.Value);
    }
}
