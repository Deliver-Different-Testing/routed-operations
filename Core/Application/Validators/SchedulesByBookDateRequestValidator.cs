using RoutedOperations.Core.Application.Dtos.BulkImport.Clients;
using RoutedOperations.Core.Application.Utilities;
using FluentValidation;
using Microsoft.AspNetCore.Http;
using Serilog;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Validators
{
    public class SchedulesByBookDateRequestValidator : AbstractValidator<SchedulesByBookDateRequest>
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public SchedulesByBookDateRequestValidator(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
            SetRules();
        }

        private void SetRules()
        {
            RuleFor(x => x.BookDate)
                .Must((request, bookDate) =>
                {
                    var tenantToday = TimeZoneUtility.GetTenantToday(_httpContextAccessor);
                    // Convert UTC BookDate to tenant timezone instead of server local time
                    var adjustedBookDate = bookDate.Kind == DateTimeKind.Utc
                        ? TimeZoneUtility.ConvertToTenantTime(bookDate, _httpContextAccessor)
                        : bookDate;
                    var isValid = tenantToday <= adjustedBookDate;

                    Log.Information($"({request.MessageId}) [Validator - GetSchedules] BookDate validation. " +
                        $"BookDate (UTC): {bookDate:yyyy-MM-dd} ({bookDate.Kind}), " +
                        $"BookDate (Tenant TZ): {adjustedBookDate:yyyy-MM-dd}, TenantToday: {tenantToday:yyyy-MM-dd}, IsValid: {isValid}");

                    if (!isValid)
                    {
                        Log.Warning($"({request.MessageId}) [Validator - GetSchedules] BookDate validation FAILED. " +
                            $"BookDate {adjustedBookDate:yyyy-MM-dd} is before TenantToday {tenantToday:yyyy-MM-dd}");
                    }

                    return isValid;
                })
                .WithMessage("'BookDate' must not be in the past.");
        }
    }
}
