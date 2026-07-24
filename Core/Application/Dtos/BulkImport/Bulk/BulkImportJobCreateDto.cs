using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    // Nullable annotations: this DTO is bound directly from the wizard
    // POST body. The project has <Nullable>enable</Nullable>, so any
    // non-nullable `string` property is treated as [Required] by the
    // ASP.NET Core model binder. The wizard legitimately omits most
    // string fields on any given row (they get enriched later by the
    // wizard's own geocode / rate steps or by the server), so every
    // string field on the request DTO is marked nullable here to keep
    // the "minimal valid job" payload accepted. Business-required
    // fields (ToAddress, JobNumber, ToContact*) are enforced by the
    // FluentValidation rules in BulkImportRequestValidator, not by
    // model-binding "requiredness".
    public class BulkImportJobCreateDto
    {
        public string? JobNumber { get; set; }
        public string? BookDate { get; set; }
        public string? FromContact { get; set; }
        public string? FromCompany { get; set; }
        public string? FromAddress { get; set; }

        // NZ-specific fields
        public string? FromSuburb { get; set; } // NZ suburb
        public string? FromPostCode { get; set; } // NZ postcode

        // US-specific fields
        public string? FromUnit { get; set; } // US unit/suite number
        public string? FromCity { get; set; } // US city
        public string? FromState { get; set; } // US state
        public string? FromZipCode { get; set; } // US zip code

        public string? FromLatitude { get; set; }
        public string? FromLongitude { get; set; }
        public int? FromGeoType { get; set; }
        public string? ToCompany { get; set; }
        public string? ToAddress { get; set; }

        // NZ-specific fields
        public string? ToSuburb { get; set; } // NZ suburb
        public string? ToPostCode { get; set; } // NZ postcode

        // US-specific fields
        public string? ToUnit { get; set; } // US unit/suite number
        public string? ToCity { get; set; } // US city
        public string? ToState { get; set; } // US state
        public string? ToZipCode { get; set; } // US zip code

        public string? ToLatitude { get; set; }
        public string? ToLongitude { get; set; }
        public int? ToGeoType { get; set; }
        public string? ToContact { get; set; }
        public string? ToContactPhone { get; set; }
        public short? Quantity { get; set; }
        public decimal Length { get; set; }
        public decimal Width { get; set; }
        public decimal Height { get; set; }
        public decimal Weight { get; set; }
        public string? ClientRefA { get; set; }
        public string? ClientRefB { get; set; }
        public string? OurRef { get; set; }
        public string? Notes { get; set; }
        public string? TrackingEmail { get; set; }
        public string? TrackingMobile { get; set; }
        public string? CourierCode { get; set; }
        public int? CourierId { get; set; }
        public decimal? Amount { get;set; }
        public decimal? CourierPercentageOverride { get; set; }

        // NZ-specific on-demand job options
        public bool? OnHold { get; set; }
        public bool? NationwideDoc { get; set; }

        // Populated when a job fails during import so the UI can show the reason per row
        public string? ErrorMessage { get; set; }

        // Resolved stop type for the row: "pickup", "dropoff" or null when not provided.
        // The frontend has already routed the row's address into the correct From*/To*
        // slots based on this value, so the backend only needs to persist/log it.
        // Downstream rating/dispatch can read it directly instead of inferring from
        // which side the address ended up on.
        public string? StopType { get; set; }
    }
}
