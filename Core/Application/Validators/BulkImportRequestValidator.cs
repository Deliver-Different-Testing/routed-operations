using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain.Models;
using FluentValidation;
using Microsoft.AspNetCore.Http;
using Serilog;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Validators
{
    public class BulkImportRequestValidator : AbstractValidator<BulkImportRequest>
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public BulkImportRequestValidator(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
            SetRules();
        }

        private bool IsNzTenant()
        {
            var countryCode = _httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value?.ToUpper();
            var nz = Country.Nz.GetDescription();
            return countryCode?.Equals(nz) ?? false;
        }

        private bool IsUsTenant()
        {
            var countryCode = _httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value?.ToUpper();
            var usa = Country.Us.GetDescription();
            // Default to US tenant if no country code claim is present.
            return countryCode?.Equals(usa) ?? true;
        }

        private void SetRules()
        {
            RuleFor(x => x.ClientId)
                .GreaterThan(0);

            // Reject batches with an empty Jobs list early rather than letting
            // it slip into ProcessRouted/OnDemand where a FirstOrDefault deref
            // used to NRE. The wizard should never send this, but the API is
            // callable directly.
            RuleFor(x => x.Jobs)
                .NotNull().WithMessage("Jobs list is required.")
                .Must(j => j != null && j.Any()).WithMessage("At least one job is required.");

            RuleFor(x => x.BookDate)
                 .Must((request, bookDate) =>
                 {
                     // Convert BookDate to tenant timezone for comparison
                     var bookDateInTenantTz = TimeZoneUtility.ConvertToTenantTime(bookDate, _httpContextAccessor);
                     var tenantNow = TimeZoneUtility.GetTenantNow(_httpContextAccessor);
                     var maxDate = TimeZoneUtility.GetTenantToday(_httpContextAccessor).AddDays(30);
                     var isValid = bookDateInTenantTz > tenantNow && bookDateInTenantTz < maxDate;

                     Log.Information($"({request.MessageId}) [Validator] BookDate validation. " +
                         $"BookDate (UTC): {bookDate:yyyy-MM-dd HH:mm:ss} ({bookDate.Kind}), " +
                         $"BookDate (Tenant TZ): {bookDateInTenantTz:yyyy-MM-dd HH:mm:ss}, " +
                         $"TenantNow: {tenantNow:yyyy-MM-dd HH:mm:ss}, " +
                         $"MaxDate: {maxDate:yyyy-MM-dd HH:mm:ss}, IsValid: {isValid}");

                     if (!isValid)
                     {
                         Log.Warning($"({request.MessageId}) [Validator] BookDate validation FAILED. " +
                             $"BookDate (Tenant TZ) must be between {tenantNow:yyyy-MM-dd HH:mm:ss} and {maxDate:yyyy-MM-dd HH:mm:ss}. " +
                             $"Received: {bookDateInTenantTz:yyyy-MM-dd HH:mm:ss}");
                     }

                     return isValid;
                 })
                 .WithMessage("'BookDate' must be in the future and within 30 days.");

            //RuleFor(x => x.BookDate.Kind == DateTimeKind.Utc ? x.BookDate.ToLocalTime() : x.BookDate)
            // .ExclusiveBetween(DateTime.Now, DateTime.Today.AddDays(30));

            RuleFor(x => x.ScheduleId)
                .GreaterThan(0)
                .When(x => x.ScheduleId.HasValue);

            // SpeedId 0 is accepted as "wizard did not choose a speed - the
            // server should apply the client's default". The strict positive
            // check that used to live here blocked the MVP direct-import
            // path (the React wizard omits the Step-6 speed picker).
            // BulkImportJobFactory still validates SpeedId against the
            // client's speed catalog before inserting, so an unknown value
            // is still refused - just with a business error, not a 400.
            RuleFor(x => x.SpeedId)
                .GreaterThanOrEqualTo(0);

            // Steve's 4-step origin precedence (US-only): if the batch is using
            // OriginLocationId (Step 3), the id must be a positive int. The
            // existence/Active check happens in BulkService at request time -
            // doing it here would force the validator to take a DB dependency.
            RuleFor(x => x.OriginLocationId)
                .GreaterThan(0)
                .When(x => x.OriginLocationId.HasValue)
                .WithMessage("Origin Location id must be a positive integer.");

            // When 'Route starts from client site' is OFF for a routed batch,
            // every job must have a populated FromAddress (the CSV must supply
            // its own origin). When the flag is ON, the server synthesizes
            // FromAddress from the client's site address, so the CSV column is
            // optional.
            RuleFor(x => x)
                .Must(req => req.Jobs != null && req.Jobs.All(j => !string.IsNullOrWhiteSpace(j.FromAddress)))
                .When(x => IsUsTenant() && !x.RouteFromClientSite && string.Equals(x.JobType, "routed", StringComparison.OrdinalIgnoreCase))
                .WithMessage("Every routed job must have a FromAddress unless 'Route starts from client site' is enabled.");

            ////Validate that all multi-box jobs have matching from and to address, multiple entries with one entry ending with '-A' and '-A' record having the largest volume
            //RuleFor(x => x.Jobs)
            //    .Must(x => !x.Where(j => !string.IsNullOrWhiteSpace(j.JobNumber) && j.JobNumber.Contains("-"))
            //                .GroupBy(j => j.JobNumber.Trim().ToUpper().Split("-")[0])
            //                .Any(y => y.Count() < 2
            //                  // || y.Count(j => j.JobNumber.Trim().ToUpper().EndsWith("-A")) != 1
            //                  // || y.Select(j => new { j.JobNumber, Volume = j.Length * j.Width * j.Height }).First(j => j.JobNumber.Trim().ToUpper().EndsWith("-A")).Volume < y.Max(j => j.Length * j.Width * j.Height)
            //                    || y.Count(j => j.JobNumber.Trim().EndsWith("-1")) != 1
            //                    //|| y.Select(j => new { j.JobNumber, Volume = j.Length * j.Width * j.Height }).First(j => j.JobNumber.Trim().EndsWith("-1")).Volume < y.Max(j => j.Length * j.Width * j.Height)
            //                    || y.GroupBy(j => new
            //                    {
            //                        FromAddress = j.FromAddress?.Trim().ToLower(),
            //                        FromSuburb = j.FromSuburb?.Trim().ToLower(),
            //                        FromLatitude = j.FromLatitude,
            //                        FromLongitude = j.FromLongitude,
            //                        ToAddress = j.ToAddress?.Trim().ToLower(),
            //                        ToSuburb = j.ToSuburb?.Trim().ToLower(),
            //                        ToLatitude = j.ToLatitude,
            //                        ToLongitude = j.ToLongitude
            //                    }).Count() != 1)
            //    )
            //    .WithMessage("Invalid or missing multi-box entries.")
            //    .When(x => x.Jobs != null && x.Jobs.Any(j => j.JobNumber.Contains("-")));

            RuleForEach(x => x.Jobs)
                .NotEmpty()
                .ChildRules(j =>
                {
                    j.RuleFor(x => x.JobNumber)
                        .MaximumLength(20).When(x => !string.IsNullOrWhiteSpace(x.JobNumber))// && x.JobNumber.Contains("-"))
                        //.MaximumLength(18).When(x => !string.IsNullOrWhiteSpace(x.JobNumber) && !x.JobNumber.Contains("-"))
                        .NotEmpty()
                        .Must(x => string.IsNullOrEmpty(x) || !x.ToLower().Any(c => "0123456789abcdefghijklmnopqrstuvwxyz-".IndexOf(c) < 0)).WithMessage("Invalid characters, job number characters must be either 0-9 or A-Z.");

                    //j.RuleFor(x => x.JobNumber)
                    //    .Must(x => x.Trim().IndexOf("-") == x.Trim().Length - 2 && "abcdefghijklmnopqrstuvwxyz".IndexOf(x.Trim().ToLower().Last()) >= 0).WithMessage("Invalid multi-box job number.")
                    //    .When(x => !string.IsNullOrWhiteSpace(x.JobNumber) && x.JobNumber.Contains("-"));

                    // FromContact is required (matches legacy BulkImportHyper
                    // which validated it NotEmpty). The wizard's Map Columns
                    // step lets the operator either map a fromContact column
                    // or set the batch-level "Override From Contact" option -
                    // both routes populate the DTO before it reaches this
                    // validator. Legacy silently rejected rows without it;
                    // returning a clear 400 here is friendlier than the
                    // downstream SP error.
                    j.RuleFor(x => x.FromContact)
                        .NotEmpty().WithMessage("From Contact is required (map a column or set the Override From Contact batch option).")
                        .MaximumLength(50);

                    // Stop type is optional. When supplied, it must be one of the
                    // values the frontend normalizer produces. Anything else means
                    // the import file had a value we couldn't classify.
                    j.RuleFor(x => x.StopType)
                        .Must(s => s == null || s == "pickup" || s == "dropoff")
                        .WithMessage("Stop Type must be 'pickup' or 'dropoff'.");

                    j.RuleFor(x => x.ToContact)
                        .NotEmpty()
                        .MaximumLength(100);

                    j.RuleFor(x => x.ToCompany)
                        .MaximumLength(150);

                    j.RuleFor(x => x.ToContactPhone)
                        .NotEmpty()
                        .MaximumLength(100);

                    j.RuleFor(x => x.ToAddress)
                        .NotEmpty()
                        .MaximumLength(150);

                    // NZ-specific validation
                    j.RuleFor(x => x.ToSuburb)
                        .NotEmpty().WithMessage("Suburb is required for NZ tenants.")
                        .MaximumLength(50)
                        .When(x => IsNzTenant());

                    j.RuleFor(x => x.ToPostCode)
                        .Must(x => !string.IsNullOrWhiteSpace(x) && int.TryParse(x.Trim(), out int parsedPostCode) && parsedPostCode > 0).WithMessage("Invalid postcode.")
                        .When(x => IsNzTenant());

                    // US-specific validation
                    j.RuleFor(x => x.ToCity)
                        .MaximumLength(50)
                        .When(x => !string.IsNullOrWhiteSpace(x.ToCity));

                    j.RuleFor(x => x.ToState)
                        .MaximumLength(50)
                        .When(x => !string.IsNullOrWhiteSpace(x.ToState));

                    j.RuleFor(x => x.ToZipCode)
                        .MaximumLength(10)
                        .When(x => !string.IsNullOrWhiteSpace(x.ToZipCode));

                    j.RuleFor(x => x.FromCity)
                        .MaximumLength(50)
                        .When(x => !string.IsNullOrWhiteSpace(x.FromCity));

                    j.RuleFor(x => x.FromState)
                        .MaximumLength(50)
                        .When(x => !string.IsNullOrWhiteSpace(x.FromState));

                    j.RuleFor(x => x.FromZipCode)
                        .MaximumLength(10)
                        .When(x => !string.IsNullOrWhiteSpace(x.FromZipCode));

                    // ToLatitude/ToLongitude are populated by the wizard's
                    // geocode step and the server's HERE fallback. Rows can
                    // legitimately arrive without coordinates - the server
                    // resolves them before rating. Keep the length cap for
                    // when a value IS supplied.
                    j.RuleFor(x => x.ToLatitude)
                        .MaximumLength(50)
                        .When(x => !string.IsNullOrWhiteSpace(x.ToLatitude));

                    j.RuleFor(x => x.ToLongitude)
                        .MaximumLength(50)
                        .When(x => !string.IsNullOrWhiteSpace(x.ToLongitude));

                    //j.RuleFor(x => x.Quantity)
                    //    .InclusiveBetween((short)1, (short)26)
                    //    .When(x => x.Quantity.HasValue);

                    j.RuleFor(x => x.Quantity)
                        .Equal((short)1)
                        .When(x => x.Quantity.HasValue && !string.IsNullOrWhiteSpace(x.JobNumber) && x.JobNumber.Contains("-")).WithMessage("Multi-box quantity must be 1.");

                    // Dimensions are only enforced when the row actually
                    // supplies them. The wizard's Step 2 "Override Dimensions"
                    // dropdown lets the operator pick a stock size that the
                    // server applies to every row - in that flow the per-row
                    // values arrive as 0 and must not be rejected. If a value
                    // > 0 IS present, the upper cap still applies.
                    j.RuleFor(x => x.Length)
                        .InclusiveBetween(0.01m, 240m)
                        .When(x => x.Length > 0);

                    j.RuleFor(x => x.Width)
                        .InclusiveBetween(0.01m, 120m)
                        .When(x => x.Width > 0);

                    j.RuleFor(x => x.Height)
                        .InclusiveBetween(0.01m, 150m)
                        .When(x => x.Height > 0);

                    j.RuleFor(x => x.Weight)
                        .InclusiveBetween(0.001m, 1000m)
                        .When(x => x.Weight > 0);

                    j.RuleFor(x => x.ClientRefA)
                        .MaximumLength(20);

                    j.RuleFor(x => x.ClientRefB)
                        .MaximumLength(15);

                    j.RuleFor(x => x.OurRef)
                        .MaximumLength(20);

                    j.RuleFor(x => x.Notes)
                        .MaximumLength(4000);

                    j.RuleFor(x => x.TrackingEmail)
                        .MaximumLength(500);

                    j.RuleFor(x => x.TrackingMobile)
                        .MaximumLength(100);

                    j.RuleFor(x => Math.Round(x.CourierPercentageOverride.Value, 4, MidpointRounding.AwayFromZero))
                        .InclusiveBetween(0m, 1m)
                        .When(x => x.CourierPercentageOverride.HasValue).WithMessage("Invalid courier percentage override.");

                });

            //RuleForEach(x => x.Jobs)
            //    .ChildRules(j =>
            //    {
            //        j.RuleFor(x => x.FromCompany)
            //            .MaximumLength(150);

            //        j.RuleFor(x => x.FromAddress)
            //            .NotEmpty()
            //            .MaximumLength(150);

            //        //j.RuleFor(x => x.FromSuburb)
            //        //    .NotEmpty()
            //        //    .MaximumLength(50);

            //        //j.RuleFor(x => x.FromPostCode)
            //        //    .Must(x => !string.IsNullOrWhiteSpace(x) && int.TryParse(x.Trim(), out int parsedPostCode) && parsedPostCode > 0).WithMessage("Invalid postcode.");

            //        j.RuleFor(x => x.FromLatitude)
            //            .NotEmpty()
            //            .MaximumLength(50);

            //        j.RuleFor(x => x.FromLongitude)
            //            .NotEmpty()
            //            .MaximumLength(50);
            //    })
            //    .When(x => x.Jobs != null && !x.ScheduleId.HasValue);
        }
    }
}
