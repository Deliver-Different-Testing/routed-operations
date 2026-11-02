#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// One row = this depot is switched OFF for this client. Absence of a row is
/// the normal state, so the table stays small and nothing has to be seeded
/// when a depot or a client is created.
///
/// The physical table is <c>tblBulkRegion_ClientLimit</c>, with the
/// underscore; the name without it does not exist on any tenant. ClientManager
/// maps the same table under the same entity name, and its PricingService is
/// the behaviour this mirrors: turning a depot off for a client INSERTS a row
/// with Deactivated = 1, and turning it back on DELETES the row rather than
/// setting the flag to 0. So Deactivated is 1 on every row that exists, and a
/// row with 0 would be a depot that is on, recorded twice, which is why the
/// read side treats presence as the signal and ignores the column.
/// </summary>
public partial class TblBulkRegionClientLimit
{
    public int Id { get; set; }
    public int? BulkRegionId { get; set; }
    public int? ClientId { get; set; }
    public bool Deactivated { get; set; }

    public virtual TblBulkRegion BulkRegion { get; set; }
}
