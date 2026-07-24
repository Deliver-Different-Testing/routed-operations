// Partial-class extensions that surface additional Despatch DB columns the
// ported BulkImportHyper support services (AddressService / ClientService)
// read at runtime. Sibling to TucClient.BulkImport.cs +
// TblBulkJob.BulkImport.cs which the parallel BulkService port owns; this
// file covers the remaining slim entities (TblBulkRegion,
// TblBulkRunSchedule) that RunBuilder's cockpit didn't need but the
// BulkImport wizard does.
//
// Convention discovers the column name from the property name; nullability
// and type mirror the source EF Power Tools scaffold verbatim.

#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

// TucClient - the parallel BulkService port owns TucClient.BulkImport.cs.
// These four Reference{A,B}{Mandatory,Message} columns weren't in that
// extension because BulkService doesn't read them; ClientService does, so
// they live here to avoid stepping on the parallel port's file.
public partial class TucClient
{
    public bool ReferenceAmandatory { get; set; }
    public string ReferenceAmessage { get; set; }
    public bool ReferenceBmandatory { get; set; }
    public string ReferenceBmessage { get; set; }
}

// TblBulkRegion - RunBuilder cockpit only needed Id + Name + Active. Bulk
// Import surfaces the origin address columns for the Step 2 dropdown.
public partial class TblBulkRegion
{
    public string FromCompany { get; set; }
    public string FromAddress { get; set; }
    public string AddressLine5 { get; set; }
    public string AddressLine6 { get; set; }
    public string AddressLine7 { get; set; }
}

// TblBulkRunSchedule - RunBuilder didn't need CutoffHours. BulkImport uses it
// to decide whether the current tenant clock has passed the schedule cutoff.
public partial class TblBulkRunSchedule
{
    public int CutoffHours { get; set; }
    public int? PostcodeGroupId { get; set; }
}
