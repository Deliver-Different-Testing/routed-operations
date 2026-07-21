using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Domain;

/// <summary>
/// Base Despatch DB context. Kept small so the derived DynamicDespatchDbContext
/// can add hand-authored entities without competing with EF Power Tools output.
/// </summary>
public partial class DespatchContext(DbContextOptions options) : DbContext(options)
{
    public virtual DbSet<TblBulkJob> TblBulkJobs { get; set; }
    public virtual DbSet<TblBulkRun> TblBulkRuns { get; set; }
    public virtual DbSet<TblBulkJobRun> TblBulkJobRuns { get; set; }
    public virtual DbSet<TblBulkRegion> TblBulkRegions { get; set; }
    public virtual DbSet<TucJobType> TucJobTypes { get; set; }
    public virtual DbSet<TucCourier> TucCouriers { get; set; }
    public virtual DbSet<TucCourierFleet> TucCourierFleets { get; set; }
    public virtual DbSet<TblBulkRunSchedule> TblBulkRunSchedules { get; set; }
    public virtual DbSet<TblBulkJobItems> TblBulkJobItems { get; set; }
    public virtual DbSet<VehicleSize> VehicleSizes { get; set; }
    public virtual DbSet<TucClient> TucClients { get; set; }
    public virtual DbSet<TblBulkScheduleLinehaul> TblBulkScheduleLinehauls { get; set; }
    public virtual DbSet<TblBulkPostCodeRunName> TblBulkPostCodeRunNames { get; set; }
    // Route module (Stage 2 - C.1'/C.2'). Shared with Configurator - same
    // Route / ZipPolygon / Dispatch_RouteRoster tables; RouteZipcodes is an
    // implicit many-to-many junction configured in OnModelCreating below.
    public virtual DbSet<Despatch.Route> Routes { get; set; }
    public virtual DbSet<ZipPolygon> ZipPolygons { get; set; }
    public virtual DbSet<DispatchRouteRoster> DispatchRouteRosters { get; set; }
    public virtual DbSet<TucAgent> TucAgents { get; set; }
    // Quoting module (Stage 2 - C.3). Shadow tables for pricing scenarios;
    // rows never promote to tblBulkJob or tucJob - live in the quoting sandbox.
    public virtual DbSet<TblQuoteJob> TblQuoteJobs { get; set; }
    public virtual DbSet<TblQuoteRun> TblQuoteRuns { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Legacy Despatch tables have hand-written triggers. EF Core 10's default
        // MERGE + OUTPUT batching is rejected by SQL Server ("The target table
        // ... cannot have any enabled triggers if the statement contains an
        // OUTPUT clause without INTO clause"). Declaring the trigger via
        // ToTable(t => t.HasTrigger(...)) makes EF fall back to the older
        // one-row-per-statement path that works with triggers. The trigger
        // name is a stub - EF only checks IF any triggers exist, not the name.
        modelBuilder.Entity<TblBulkJob>(entity =>
        {
            entity.ToTable("tblBulkJob", t => t.HasTrigger("legacy_trigger"));
            entity.HasKey(e => e.BulkJobId);
        });

        modelBuilder.Entity<TblBulkRun>(entity =>
        {
            entity.ToTable("tblBulkRun", t => t.HasTrigger("legacy_trigger"));
            entity.HasKey(e => e.Id);
        });

        modelBuilder.Entity<TblBulkJobRun>(entity =>
        {
            entity.ToTable("tblBulkJobRun", t => t.HasTrigger("legacy_trigger"));
            entity.HasKey(e => e.Id);
            entity.HasOne(e => e.BulkJob)
                .WithMany(j => j.TblBulkJobRuns)
                .HasForeignKey(e => e.BulkJobId);
            entity.HasOne(e => e.Run)
                .WithMany(r => r.TblBulkJobRuns)
                .HasForeignKey(e => e.RunId);
        });

        modelBuilder.Entity<TblBulkRegion>(entity =>
        {
            entity.ToTable("tblBulkRegion");
            entity.HasKey(e => e.BulkRegionId);
        });

        modelBuilder.Entity<TucJobType>(entity =>
        {
            entity.HasKey(e => e.UcjtId);
        });

        modelBuilder.Entity<TucCourier>(entity =>
        {
            entity.HasKey(e => e.UccrId);
        });

        modelBuilder.Entity<TucCourierFleet>(entity =>
        {
            entity.HasKey(e => e.UccfId);
        });

        modelBuilder.Entity<TblBulkRunSchedule>(entity =>
        {
            entity.HasKey(e => e.BulkRunScheduleId);
        });

        modelBuilder.Entity<TblBulkJobItems>(entity =>
        {
            entity.HasKey(e => e.Id);
        });

        modelBuilder.Entity<VehicleSize>(entity =>
        {
            entity.HasKey(e => e.VehicleSizeId);
        });

        modelBuilder.Entity<TucClient>(entity =>
        {
            entity.HasKey(e => e.UcclId);
        });

        modelBuilder.Entity<TblBulkScheduleLinehaul>(entity =>
        {
            entity.HasKey(e => e.Id);
        });

        modelBuilder.Entity<TblBulkPostCodeRunName>(entity =>
        {
            entity.HasKey(e => e.Id);
        });

        // Route <-> ZipPolygon many-to-many via the implicit "RouteZipcodes"
        // junction table (RouteId + ZipPolygonId composite PK). Configuration
        // mirrors the Configurator scaffold so both apps share the same
        // physical junction with matching FK constraint names.
        modelBuilder.Entity<Despatch.Route>(entity =>
        {
            entity.HasMany(r => r.ZipPolygons)
                .WithMany(z => z.Routes)
                .UsingEntity<Dictionary<string, object>>(
                    "RouteZipcode",
                    j => j.HasOne<ZipPolygon>().WithMany()
                        .HasForeignKey("ZipPolygonId")
                        .OnDelete(DeleteBehavior.ClientSetNull)
                        .HasConstraintName("FK_RouteZipcodes_ZipPolygon"),
                    j => j.HasOne<Despatch.Route>().WithMany()
                        .HasForeignKey("RouteId")
                        .HasConstraintName("FK_RouteZipcodes_Routes"),
                    j =>
                    {
                        j.HasKey("RouteId", "ZipPolygonId");
                        j.ToTable("RouteZipcodes");
                    });
        });

        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
