// Ported from BulkImportHyper/Application/Domain/Despatch/DespatchContextExtensions.cs.
// Adds the keyless DbSets the ported BulkService uses to receive SP results,
// plus the AssignJobNumbers wrapper (an OUTPUT-parameter SP) that BulkImport
// calls from three places (routed, on-demand, staff import).
//
// The keyless entities are registered via OnModelCreatingPartial (the base
// context's OnModelCreating already invokes the partial - see DespatchContext.cs
// line ~395). We only wire what BulkImport needs; RunBuilder's own context
// configuration remains untouched.
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain.Models;

namespace RoutedOperations.Core.Domain;

public partial class DespatchContext
{
    public virtual DbSet<ZoneRate> ZoneRates { get; set; }
    public virtual DbSet<ZoneLinehaulRate> ZoneLinehaulRate { get; set; }
    public virtual DbSet<Rate> Rates { get; set; }
    public virtual DbSet<UrgentRate> UrgentRates { get; set; }
    public virtual DbSet<SuburbIDResult> SuburbID { get; set; }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Rate>().HasNoKey();
        modelBuilder.Entity<ZoneRate>().HasNoKey();
        modelBuilder.Entity<UrgentRate>().HasNoKey();
        modelBuilder.Entity<ZoneLinehaulRate>().HasNoKey();
        modelBuilder.Entity<SuburbIDResult>().HasNoKey();
    }

    /// <summary>
    /// Wraps <c>sp_AssignJobNumbers</c>. Ported byte-identical from
    /// BulkImportHyper - the SP holds a per-tenant sequence lock so
    /// concurrent bookings do not collide on the same auto-generated
    /// number. Returns the FIRST number in the reserved range; caller
    /// increments it locally to fill in `numberOfRecords` jobs.
    /// </summary>
    public async Task<int> AssignJobNumbersAsync(int clientId, int numberOfRecords)
    {
        var firstNumber = new SqlParameter
        {
            ParameterName = "FirstNumber",
            SqlDbType = System.Data.SqlDbType.Int,
            Direction = System.Data.ParameterDirection.Output,
        };
        await this.Database.ExecuteSqlRawAsync(
            "EXEC sp_AssignJobNumbers @ClientId, @NumberOfRecords, @FirstNumber OUTPUT",
            new SqlParameter("ClientId", clientId),
            new SqlParameter("NumberOfRecords", numberOfRecords),
            firstNumber);
        return (int)firstNumber.Value;
    }
}
