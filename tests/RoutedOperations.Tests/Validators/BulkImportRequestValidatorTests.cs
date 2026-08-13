using System.Security.Claims;
using FluentValidation.TestHelper;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Validators;

namespace RoutedOperations.Tests.Validators;

public class BulkImportRequestValidatorTests
{
    private static IHttpContextAccessor AccessorWith(params Claim[] claims)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(claims));
        accessor.HttpContext.Returns(http);
        return accessor;
    }

    private static IHttpContextAccessor UsTenant() =>
        AccessorWith(new Claim("CountryCode", "US"), new Claim("TimeZone", "America/New_York"));

    private static IHttpContextAccessor NzTenant() =>
        AccessorWith(new Claim("CountryCode", "NZ"), new Claim("TimeZone", "Pacific/Auckland"));

    private static IHttpContextAccessor NoCountryClaim() =>
        AccessorWith(new Claim("TimeZone", "America/New_York"));

    private static BulkImportJobCreateDto ValidUsJob() => new()
    {
        JobNumber = "JOB001",
        FromContact = "Sender",
        FromAddress = "123 Main St",
        ToContact = "Recipient",
        ToContactPhone = "555-0100",
        ToAddress = "456 Elm St",
        StopType = "dropoff",
    };

    private static BulkImportJobCreateDto ValidNzJob() => new()
    {
        JobNumber = "JOB001",
        FromContact = "Sender",
        FromAddress = "123 Queen St",
        ToContact = "Recipient",
        ToContactPhone = "021-555-100",
        ToAddress = "456 Ponsonby Rd",
        ToSuburb = "Grey Lynn",
        ToPostCode = "1021",
        StopType = "pickup",
    };

    private static BulkImportRequest ValidUsRequest() => new()
    {
        ClientId = 1,
        BookDate = DateTime.UtcNow.AddDays(2),
        SpeedId = 0,
        JobType = "ondemand",
        Jobs = new[] { ValidUsJob() },
    };

    private static BulkImportRequest ValidNzRequest() => new()
    {
        ClientId = 1,
        BookDate = DateTime.UtcNow.AddDays(2),
        SpeedId = 0,
        JobType = "ondemand",
        Jobs = new[] { ValidNzJob() },
    };

    [Fact]
    public void UsTenant_HappyPath_Passes()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var result = sut.TestValidate(ValidUsRequest());
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void NzTenant_HappyPath_Passes()
    {
        var sut = new BulkImportRequestValidator(NzTenant());
        var result = sut.TestValidate(ValidNzRequest());
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void ClientId_NotPositive_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.ClientId = 0;
        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.ClientId);
    }

    [Fact]
    public void Jobs_Null_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = null;
        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.Jobs);
    }

    [Fact]
    public void Jobs_Empty_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = Array.Empty<BulkImportJobCreateDto>();
        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.Jobs);
    }

    [Fact]
    public void BookDate_InPast_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.BookDate = DateTime.UtcNow.AddDays(-1);
        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.BookDate);
    }

    [Fact]
    public void BookDate_TooFarInFuture_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.BookDate = DateTime.UtcNow.AddDays(60);
        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.BookDate);
    }

    [Fact]
    public void ScheduleId_ZeroValue_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.ScheduleId = 0;
        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.ScheduleId);
    }

    [Fact]
    public void ScheduleId_Positive_Passes()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.ScheduleId = 5;
        var result = sut.TestValidate(req);
        result.ShouldNotHaveValidationErrorFor(x => x.ScheduleId);
    }

    [Fact]
    public void SpeedId_Negative_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.SpeedId = -1;
        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.SpeedId);
    }

    [Fact]
    public void SpeedId_ZeroAccepted()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.SpeedId = 0;
        var result = sut.TestValidate(req);
        result.ShouldNotHaveValidationErrorFor(x => x.SpeedId);
    }

    [Fact]
    public void OriginLocationId_NotPositive_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.OriginLocationId = 0;
        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.OriginLocationId);
    }

    [Fact]
    public void OriginLocationId_Positive_Passes()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.OriginLocationId = 3;
        var result = sut.TestValidate(req);
        result.ShouldNotHaveValidationErrorFor(x => x.OriginLocationId);
    }

    [Fact]
    public void RoutedJob_MissingFromAddress_UsTenant_Fails()
    {
        // Batch-level 'RouteFromClientSite = false' + JobType = "routed"
        // triggers the rule that every job's FromAddress must be populated.
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.JobType = "routed";
        req.RouteFromClientSite = false;
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = "Sender",
                FromAddress = null,
                ToContact = "Recipient",
                ToContactPhone = "555-0100",
                ToAddress = "456 Elm St",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x);
    }

    [Fact]
    public void RoutedJob_RouteFromClientSite_MissingFromAddress_Passes()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.JobType = "routed";
        req.RouteFromClientSite = true;
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = "Sender",
                FromAddress = null,
                ToContact = "Recipient",
                ToContactPhone = "555-0100",
                ToAddress = "456 Elm St",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void NzTenant_MissingSuburb_Fails()
    {
        var sut = new BulkImportRequestValidator(NzTenant());
        var req = ValidNzRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = "Sender",
                FromAddress = "123 Queen St",
                ToContact = "Recipient",
                ToContactPhone = "021-555-100",
                ToAddress = "456 Ponsonby Rd",
                ToSuburb = null,
                ToPostCode = "1021",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].ToSuburb");
    }

    [Fact]
    public void NzTenant_InvalidPostCode_Fails()
    {
        var sut = new BulkImportRequestValidator(NzTenant());
        var req = ValidNzRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = "Sender",
                FromAddress = "123 Queen St",
                ToContact = "Recipient",
                ToContactPhone = "021-555-100",
                ToAddress = "456 Ponsonby Rd",
                ToSuburb = "Grey Lynn",
                ToPostCode = "abcd",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].ToPostCode");
    }

    [Fact]
    public void UsTenant_MissingSuburbAndPostcode_Passes()
    {
        // NZ-only rules do not fire for US tenant even when the fields are missing.
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        var result = sut.TestValidate(req);
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void NoCountryClaim_DefaultsToUsTenant()
    {
        // Per IsUsTenant() the default when the claim is missing is true (US).
        // That means the US-specific "routed job needs FromAddress" rule fires
        // when RouteFromClientSite is false + JobType is routed.
        var sut = new BulkImportRequestValidator(NoCountryClaim());
        var req = new BulkImportRequest
        {
            ClientId = 1,
            BookDate = DateTime.UtcNow.AddDays(2),
            SpeedId = 0,
            JobType = "routed",
            RouteFromClientSite = false,
            Jobs = new[]
            {
                new BulkImportJobCreateDto
                {
                    JobNumber = "JOB001",
                    FromContact = "Sender",
                    FromAddress = null,
                    ToContact = "Recipient",
                    ToContactPhone = "555-0100",
                    ToAddress = "456 Elm St",
                },
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x);
    }

    [Fact]
    public void JobNumber_Empty_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = string.Empty,
                FromContact = "Sender",
                FromAddress = "123 Main St",
                ToContact = "Recipient",
                ToContactPhone = "555-0100",
                ToAddress = "456 Elm St",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].JobNumber");
    }

    [Fact]
    public void JobNumber_TooLong_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = new string('A', 25),
                FromContact = "Sender",
                FromAddress = "123 Main St",
                ToContact = "Recipient",
                ToContactPhone = "555-0100",
                ToAddress = "456 Elm St",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].JobNumber");
    }

    [Fact]
    public void JobNumber_InvalidCharacters_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB@001",
                FromContact = "Sender",
                FromAddress = "123 Main St",
                ToContact = "Recipient",
                ToContactPhone = "555-0100",
                ToAddress = "456 Elm St",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].JobNumber");
    }

    [Fact]
    public void FromContact_Empty_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = string.Empty,
                FromAddress = "123 Main St",
                ToContact = "Recipient",
                ToContactPhone = "555-0100",
                ToAddress = "456 Elm St",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].FromContact");
    }

    [Fact]
    public void StopType_Invalid_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = "Sender",
                FromAddress = "123 Main St",
                ToContact = "Recipient",
                ToContactPhone = "555-0100",
                ToAddress = "456 Elm St",
                StopType = "somethingelse",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].StopType");
    }

    [Theory]
    [InlineData("pickup")]
    [InlineData("dropoff")]
    [InlineData(null)]
    public void StopType_Valid_Passes(string? stopType)
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = "Sender",
                FromAddress = "123 Main St",
                ToContact = "Recipient",
                ToContactPhone = "555-0100",
                ToAddress = "456 Elm St",
                StopType = stopType,
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldNotHaveValidationErrorFor("Jobs[0].StopType");
    }

    [Fact]
    public void ToContact_Empty_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = "Sender",
                FromAddress = "123 Main St",
                ToContact = string.Empty,
                ToContactPhone = "555-0100",
                ToAddress = "456 Elm St",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].ToContact");
    }

    [Fact]
    public void ToContactPhone_Empty_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = "Sender",
                FromAddress = "123 Main St",
                ToContact = "Recipient",
                ToContactPhone = string.Empty,
                ToAddress = "456 Elm St",
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].ToContactPhone");
    }

    [Fact]
    public void ToAddress_Empty_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        req.Jobs = new[]
        {
            new BulkImportJobCreateDto
            {
                JobNumber = "JOB001",
                FromContact = "Sender",
                FromAddress = "123 Main St",
                ToContact = "Recipient",
                ToContactPhone = "555-0100",
                ToAddress = string.Empty,
            },
        };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].ToAddress");
    }

    [Fact]
    public void Dimensions_OverMax_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        var job = ValidUsJob();
        job.Length = 500m;
        job.Width = 500m;
        job.Height = 500m;
        job.Weight = 5000m;
        req.Jobs = new[] { job };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].Length");
        result.ShouldHaveValidationErrorFor("Jobs[0].Width");
        result.ShouldHaveValidationErrorFor("Jobs[0].Height");
        result.ShouldHaveValidationErrorFor("Jobs[0].Weight");
    }

    [Fact]
    public void Dimensions_ZeroValues_Passes()
    {
        // Overrides at wizard time produce 0 - the rule fires only when > 0.
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        var job = ValidUsJob();
        job.Length = 0m;
        job.Width = 0m;
        job.Height = 0m;
        job.Weight = 0m;
        req.Jobs = new[] { job };

        var result = sut.TestValidate(req);
        result.ShouldNotHaveValidationErrorFor("Jobs[0].Length");
        result.ShouldNotHaveValidationErrorFor("Jobs[0].Width");
        result.ShouldNotHaveValidationErrorFor("Jobs[0].Height");
        result.ShouldNotHaveValidationErrorFor("Jobs[0].Weight");
    }

    [Fact]
    public void MultiboxJob_QuantityNotOne_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        var job = ValidUsJob();
        job.JobNumber = "JOB001-A";
        job.Quantity = 3;
        req.Jobs = new[] { job };

        var result = sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Jobs[0].Quantity");
    }

    [Fact]
    public void CourierPercentageOverride_OutOfRange_Fails()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        var job = ValidUsJob();
        job.CourierPercentageOverride = 1.5m;
        req.Jobs = new[] { job };

        var result = sut.TestValidate(req);
        Assert.False(result.IsValid);
    }

    [Fact]
    public void CourierPercentageOverride_InRange_Passes()
    {
        var sut = new BulkImportRequestValidator(UsTenant());
        var req = ValidUsRequest();
        var job = ValidUsJob();
        job.CourierPercentageOverride = 0.25m;
        req.Jobs = new[] { job };

        var result = sut.TestValidate(req);
        result.ShouldNotHaveAnyValidationErrors();
    }
}
