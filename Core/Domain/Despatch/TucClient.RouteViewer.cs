// Route Viewer P0 partial-class extension of TucClient. Adds NpAgentId
// which is the linkage from a client login to their Network Partner
// agent record. Consumed by NpScopeResolver's Rule-3 fallback path
// (when the Hub cookie does not stamp the NpAgentId claim directly,
// resolver looks it up via TucClient.NpAgentId keyed on the ClientID
// claim).
//
// Mirrors the TucClient.BulkImport.cs extension pattern - one file per
// consumer module so touching one module's additions does not risk the
// other's compile.
//
// Schema dependency: the NpAgentId column must exist on the target DB.
// Landed via migration 20260513123935_NPMarketplaceAndQuotes.sql per
// Section W of Runviewer-migration-tasktodo.md. Verify applied on
// every tenant DB before P0 ships (deploy dep).
#nullable disable

using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucClient
{
    [Column("NpAgentID")]
    public int? NpAgentId { get; set; }
}
