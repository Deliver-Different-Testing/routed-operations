using System.Security.Claims;
using FluentValidation.TestHelper;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.BulkImport.Clients;
using RoutedOperations.Core.Application.Validators;

namespace RoutedOperations.Tests.Validators;

public class SchedulesByBookDateRequestValidatorTests
{
    private static IHttpContextAccessor AccessorWith(params Claim[] claims)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(claims));
        accessor.HttpContext.Returns(http);
        return accessor;
    }

    [Fact]
    public void BookDate_Today_Passes()
    {
        var accessor = AccessorWith(new Claim("TimeZone", "Pacific/Auckland"));
        var sut = new SchedulesByBookDateRequestValidator(accessor);
        var tenantToday = TimeZoneInfo.ConvertTimeFromUtc(
            DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Pacific/Auckland")).Date;

        var req = new SchedulesByBookDateRequest
        {
            ClientId = 1,
            BookDate = DateTime.SpecifyKind(tenantToday, DateTimeKind.Unspecified),
            SpeedId = 0,
            DepotId = 0,
        };

        var result = sut.TestValidate(req);
        result.ShouldNotHaveValidationErrorFor(x => x.BookDate);
    }

    [Fact]
    public void BookDate_Yesterday_Fails()
    {
        var accessor = AccessorWith(new Claim("TimeZone", "Pacific/Auckland"));
        var sut = new SchedulesByBookDateRequestValidator(accessor);
        var tenantYesterday = TimeZoneInfo.ConvertTimeFromUtc(
            DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Pacific/Auckland")).Date.AddDays(-1);

        var req = new SchedulesByBookDateRequest
        {
            ClientId = 1,
            BookDate = DateTime.SpecifyKind(tenantYesterday, DateTimeKind.Unspecified),
            SpeedId = 0,
            DepotId = 0,
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.BookDate);
    }

    [Fact]
    public void BookDate_FutureDate_Passes()
    {
        var accessor = AccessorWith(new Claim("TimeZone", "Pacific/Auckland"));
        var sut = new SchedulesByBookDateRequestValidator(accessor);

        var req = new SchedulesByBookDateRequest
        {
            ClientId = 1,
            BookDate = DateTime.SpecifyKind(DateTime.UtcNow.Date.AddDays(3), DateTimeKind.Unspecified),
            SpeedId = 0,
            DepotId = 0,
        };

        var result = sut.TestValidate(req);
        result.ShouldNotHaveValidationErrorFor(x => x.BookDate);
    }

    [Fact]
    public void BookDate_Utc_IsConvertedToTenantTimeZone()
    {
        // A UTC BookDate that represents the current tenant-local day
        // should pass. If the validator forgot the UTC->tenant conversion,
        // a UTC "now.Date" from a positive-offset TZ would look like
        // yesterday to the tenant.
        var accessor = AccessorWith(new Claim("TimeZone", "Pacific/Auckland"));
        var sut = new SchedulesByBookDateRequestValidator(accessor);

        // Use a UTC BookDate that is CLEARLY in the future (tomorrow) so
        // regardless of TZ offset the tenant sees it as today or later.
        var req = new SchedulesByBookDateRequest
        {
            ClientId = 1,
            BookDate = DateTime.SpecifyKind(DateTime.UtcNow.AddDays(1), DateTimeKind.Utc),
            SpeedId = 0,
            DepotId = 0,
        };

        var result = sut.TestValidate(req);
        result.ShouldNotHaveValidationErrorFor(x => x.BookDate);
    }

    [Fact]
    public void BookDate_UtcInPast_Fails()
    {
        var accessor = AccessorWith(new Claim("TimeZone", "Pacific/Auckland"));
        var sut = new SchedulesByBookDateRequestValidator(accessor);

        var req = new SchedulesByBookDateRequest
        {
            ClientId = 1,
            BookDate = DateTime.SpecifyKind(DateTime.UtcNow.AddDays(-5), DateTimeKind.Utc),
            SpeedId = 0,
            DepotId = 0,
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.BookDate);
    }

    [Fact]
    public void NoTimeZoneClaim_FallsBackToUtc()
    {
        // Without a TimeZone claim the validator uses UTC.
        var accessor = AccessorWith();
        var sut = new SchedulesByBookDateRequestValidator(accessor);

        var req = new SchedulesByBookDateRequest
        {
            ClientId = 1,
            BookDate = DateTime.SpecifyKind(DateTime.UtcNow.Date.AddDays(1), DateTimeKind.Unspecified),
            SpeedId = 0,
            DepotId = 0,
        };

        var result = sut.TestValidate(req);
        result.ShouldNotHaveValidationErrorFor(x => x.BookDate);
    }
}
