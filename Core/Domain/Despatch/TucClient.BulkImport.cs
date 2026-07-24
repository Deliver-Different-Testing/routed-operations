// Partial-class extension of TucClient that adds every column the ported
// BulkService code needs to read/write. The base TucClient.cs is a minimal
// two-column mapping (UcclID + MaxJobsPerRun) that pre-dates the BulkImport
// port; extending it here rather than editing the base file keeps the
// original slim RunBuilder consumers unaffected.
//
// Column names use the EF convention (Ucclxxx -> UcclXxx property with an
// implicit [Column("UcclXxx")] via the case-insensitive DB match), except
// where the source class uses a shape that would not round-trip. Those get
// an explicit [Column] attribute so the mapping stays deterministic.
//
// All properties come straight from BulkImportHyper/Application/Domain/Despatch/TucClient.cs
// so behavior stays byte-identical - do NOT change types or nullability
// without also updating the ported services.
#nullable disable

using System.ComponentModel.DataAnnotations.Schema;
using System.Collections.Generic;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucClient
{
    [Column("ucclName")]
    public string UcclName { get; set; }

    [Column("ucclLegalName")]
    public string UcclLegalName { get; set; }

    [Column("ucclCode")]
    public string UcclCode { get; set; }

    [Column("ucclAddress")]
    public string UcclAddress { get; set; }

    [Column("ucclSuburbID")]
    public int? UcclSuburbId { get; set; }

    [Column("ucclPostCode")]
    public string UcclPostCode { get; set; }

    [Column("ucclActive")]
    public bool UcclActive { get; set; }

    public decimal? Longitude { get; set; }
    public decimal? Latitude { get; set; }

    public decimal? Ppdrate { get; set; }

    public decimal Discount { get; set; }

    public string JobPrefix { get; set; }

    public decimal? AddonPercentage { get; set; }

    public bool? CreateBulkHomeDeliveryPickup { get; set; }

    public bool ContentsUnknownForBulkJobs { get; set; }

    public bool ContentsUnknownAtPickup { get; set; }

    // Nav properties consumed by the ported services. Kept as ICollection so
    // Include() calls compile; the actual join is discovered by FK convention
    // (BulkImport child tables carry a `ClientID` column) so no extra
    // ModelBuilder wiring is needed here.
    public virtual ICollection<TucClientContact> TucClientContacts { get; set; } = new List<TucClientContact>();
    public virtual ICollection<TblClientContact> TblClientContacts { get; set; } = new List<TblClientContact>();

    // TucSuburb nav for the linehaul depot-address resolver. GetClientContext
    // eagerly loads client.UcclSuburb via .Include(...) and then reads
    // UcclSuburb.UcsuId as a fallback when UcclSuburbId is null. Mapping the
    // relationship here lets EF discover it via the UcclSuburbId FK.
    [ForeignKey(nameof(UcclSuburbId))]
    public virtual TucSuburb UcclSuburb { get; set; }
}
