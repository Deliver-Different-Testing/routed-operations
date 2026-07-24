using System;
using System.Linq;
using Microsoft.AspNetCore.Http;
using Serilog;

namespace RoutedOperations.Core.Application.Utilities
{
    /// <summary>
    /// Utility class for handling tenant-specific timezone conversions.
    /// Ported verbatim from BulkImportHyper.
    /// </summary>
    public static class TimeZoneUtility
    {
        public static DateTime GetTenantNow(IHttpContextAccessor httpContextAccessor)
        {
            var tenantTimeZoneId = httpContextAccessor.HttpContext?.User?.Claims
                .FirstOrDefault(x => x.Type == "TimeZone")?.Value;

            var utcNow = DateTime.UtcNow;

            if (string.IsNullOrEmpty(tenantTimeZoneId))
            {
                Log.Warning("[TimeZone] No timezone claim found in JWT. Falling back to UTC. UTC Now: {UtcNow}", utcNow);
                return utcNow;
            }

            var tenantNow = GetTenantNow(tenantTimeZoneId);
            Log.Information("[TimeZone] Tenant timezone: {TimeZoneId}, UTC Now: {UtcNow}, Tenant Now: {TenantNow}",
                tenantTimeZoneId, utcNow, tenantNow);

            return tenantNow;
        }

        public static DateTime GetTenantNow(string timeZoneId)
        {
            try
            {
                var tenantTimeZone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
                var utcNow = DateTime.UtcNow;
                var tenantNow = TimeZoneInfo.ConvertTimeFromUtc(utcNow, tenantTimeZone);

                Log.Debug("[TimeZone] Converting UTC to tenant time. TimeZoneId: {TimeZoneId}, UTC: {UtcNow}, Tenant: {TenantNow}, Offset: {Offset}",
                    timeZoneId, utcNow, tenantNow, tenantTimeZone.GetUtcOffset(utcNow));

                return tenantNow;
            }
            catch (TimeZoneNotFoundException ex)
            {
                Log.Error(ex, "[TimeZone] TimeZone not found: {TimeZoneId}. Falling back to UTC.", timeZoneId);
                return DateTime.UtcNow;
            }
        }

        public static DateTime ConvertToTenantTime(DateTime dateTime, IHttpContextAccessor httpContextAccessor)
        {
            var tenantTimeZoneId = httpContextAccessor.HttpContext?.User?.Claims
                .FirstOrDefault(x => x.Type == "TimeZone")?.Value;

            if (string.IsNullOrEmpty(tenantTimeZoneId))
            {
                return dateTime;
            }

            return ConvertToTenantTime(dateTime, tenantTimeZoneId);
        }

        public static DateTime ConvertToTenantTime(DateTime dateTime, string timeZoneId)
        {
            try
            {
                var tenantTimeZone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);

                if (dateTime.Kind == DateTimeKind.Utc)
                {
                    return TimeZoneInfo.ConvertTimeFromUtc(dateTime, tenantTimeZone);
                }

                if (dateTime.Kind == DateTimeKind.Unspecified)
                {
                    return TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(dateTime, DateTimeKind.Utc), tenantTimeZone);
                }

                return dateTime;
            }
            catch (TimeZoneNotFoundException)
            {
                return dateTime;
            }
        }

        public static DateTime GetTenantToday(IHttpContextAccessor httpContextAccessor)
        {
            return GetTenantNow(httpContextAccessor).Date;
        }
    }
}
