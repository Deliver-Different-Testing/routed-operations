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
    // Schedules module - drop-off targets. Read-only in this app (legacy
    // ClientManager still owns the CRUD surface).
    public virtual DbSet<TblDropOffLocation> TblDropOffLocations { get; set; }
    // Schedules module - header table added 2026-09-08 by
    // AddScheduleHeaderAndIdKeyedLinks. One row per schedule group;
    // owns the canonical Name + IsDefault + RetiredUtc soft-delete.
    // Day rows in TblBulkRunSchedule FK back via BulkRunScheduleGroupId.
    public virtual DbSet<BulkRunScheduleHeader> BulkRunScheduleHeaders { get; set; }
    // Client link table: reshaped 2026-09-08 from (ScheduleName, ClientId)
    // to (BulkRunScheduleId, ClientId) FK-referencing the header.
    // Postcode + polygon junctions still keyed on ScheduleName (out of
    // scope for this MR).
    public virtual DbSet<ScheduleClient> ScheduleClients { get; set; }
    public virtual DbSet<SchedulePostcode> SchedulePostcodes { get; set; }
    public virtual DbSet<SchedulePolygon> SchedulePolygons { get; set; }
    // Schedule Bundles (Dane's bundle-of-schedules concept). Added
    // 2026-09-14 by AddBaseScheduleIdAndScheduleGroupTables; renamed
    // 2026-09-22 by RenameScheduleGroupToBundle per Steve F18. The
    // link table (ScheduleClients) stays the sole record of who uses
    // what; attaching a client to a bundle writes one link row per
    // non-default member schedule.
    public virtual DbSet<BulkRunScheduleBundle> BulkRunScheduleBundles { get; set; }
    public virtual DbSet<BulkRunScheduleBundleMember> BulkRunScheduleBundleMembers { get; set; }
    // Client override delta table (Steve F1, 2026-09-22 by
    // AddClientOverrideDeltas). Stores per-client differences against a
    // schedule instead of cloning the whole schedule via BaseScheduleId.
    // Read path: dbo.fnScheduleForClient (inline TVF) joins overrides
    // to base values via COALESCE. Clustered on
    // (ScheduleId, ClientId, Scope, LegOrdinal, DayOfWeek).
    public virtual DbSet<BulkRunScheduleOverride> BulkRunScheduleOverrides { get; set; }
    // Route module (Stage 2 - C.1'/C.2'). Shared with Configurator - same
    // Route / ZipPolygon / Dispatch_RouteRoster tables; RouteZipcodes is an
    // implicit many-to-many junction configured in OnModelCreating below.
    public virtual DbSet<Despatch.Route> Routes { get; set; }
    public virtual DbSet<ZipPolygon> ZipPolygons { get; set; }
    public virtual DbSet<BulkRunPolygon> BulkRunPolygons { get; set; }
    public virtual DbSet<BulkRunPolygonPoint> BulkRunPolygonPoints { get; set; }
    public virtual DbSet<DispatchRouteRoster> DispatchRouteRosters { get; set; }
    public virtual DbSet<TucAgent> TucAgents { get; set; }
    // Quoting module (Stage 2 - C.3). Shadow tables for pricing scenarios;
    // rows never promote to tblBulkJob or tucJob - live in the quoting sandbox.
    public virtual DbSet<TblQuoteJob> TblQuoteJobs { get; set; }
    public virtual DbSet<TblQuoteRun> TblQuoteRuns { get; set; }
    // Driver Scheduling module (2026-09-07 port from CourierManager).
    // Five CourierSchedule* tables + supporting VehicleType lookup and
    // tucManualMessage SMS queue. Tenant DB shared with the CourierManager
    // legacy app; see plan `abundant-sniffing-sparkle.md` for the port
    // scope, Kevin's Day-1 decisions (NZ + US live, RouteBuilder.* auth,
    // legacy stays live), and the trigger analysis. Two DB triggers on
    // CourierScheduleResponse enforce overbooking (`Time Slot has already
    // been filled.`) - DriverSchedulingService wraps SaveChanges to
    // translate that RAISERROR to a clean 409.
    public virtual DbSet<CourierSchedule> CourierSchedules { get; set; }
    public virtual DbSet<CourierScheduleTimeSlot> CourierScheduleTimeSlots { get; set; }
    public virtual DbSet<CourierScheduleTimeSlotVehicleType> CourierScheduleTimeSlotVehicleTypes { get; set; }
    public virtual DbSet<CourierScheduleResponse> CourierScheduleResponses { get; set; }
    public virtual DbSet<CourierScheduleResponseStatus> CourierScheduleResponseStatuses { get; set; }
    public virtual DbSet<VehicleType> VehicleTypes { get; set; }
    public virtual DbSet<TucManualMessage> TucManualMessages { get; set; }
    // BulkImportHyper port (Phase 1 Task 3 - 2026-07-22). The 27 entities below
    // were auto-generated by EF Power Tools against Despatch DB and mirror the
    // BulkImportHyper scaffold. Naming (plural DbSet on singular entity) and
    // #nullable disable on the entity files matches the Power Tools convention.
    // OnModelCreating configuration for these entities is minimal: HasKey +
    // ToTable only, without the reciprocal HasOne/WithMany chains that the
    // Power Tools scaffold uses. The reason is the RunBuilder side already
    // owned slim hand-written variants of TucClient / TucCourier / TucJobType
    // / TblBulk* which do NOT expose the collection nav properties BulkImport
    // needs. Full FK config lives on the OWNING side (child entity) only;
    // EF Core auto-discovers the FK column by convention.
    public virtual DbSet<BulkImportBatch> BulkImportBatches { get; set; }
    public virtual DbSet<BulkImportJobNumber> BulkImportJobNumbers { get; set; }
    public virtual DbSet<BulkImportSpeed> BulkImportSpeeds { get; set; }
    public virtual DbSet<BulkImportTemplate> BulkImportTemplates { get; set; }
    public virtual DbSet<BulkImportTemplateMapping> BulkImportTemplateMappings { get; set; }
    public virtual DbSet<BulkZonePostcode> BulkZonePostcodes { get; set; }
    public virtual DbSet<BulkZonePostcodeGroup> BulkZonePostcodeGroups { get; set; }
    public virtual DbSet<BulkZonePostcodeSurcharge> BulkZonePostcodeSurcharges { get; set; }
    public virtual DbSet<BulkZoneSchedule> BulkZoneSchedules { get; set; }
    public virtual DbSet<JobDeliveryJourney> JobDeliveryJourneys { get; set; }
    public virtual DbSet<TblBulkJobNote> TblBulkJobNotes { get; set; }
    public virtual DbSet<TblClientAvailableSpeed> TblClientAvailableSpeeds { get; set; }
    public virtual DbSet<TblClientContact> TblClientContacts { get; set; }
    public virtual DbSet<TblClientDefaultAvailableSpeed> TblClientDefaultAvailableSpeeds { get; set; }
    public virtual DbSet<TblGssstockSize> TblGssstockSizes { get; set; }
    public virtual DbSet<TblSite> TblSites { get; set; }
    public virtual DbSet<TblbulkLinehaulRun> TblbulkLinehaulRuns { get; set; }
    public virtual DbSet<TucClientContact> TucClientContacts { get; set; }
    public virtual DbSet<TucJob> TucJobs { get; set; }
    public virtual DbSet<TucJobBooking> TucJobBookings { get; set; }
    public virtual DbSet<TucJobStatus> TucJobStatuses { get; set; }
    public virtual DbSet<TucNote> TucNotes { get; set; }
    public virtual DbSet<TucNoteType> TucNoteTypes { get; set; }
    public virtual DbSet<TucSuburb> TucSuburbs { get; set; }
    public virtual DbSet<ZoneCombo> ZoneCombos { get; set; }
    public virtual DbSet<ZoneGroup> ZoneGroups { get; set; }
    public virtual DbSet<ZoneName> ZoneNames { get; set; }
    public virtual DbSet<ZoneZip> ZoneZips { get; set; }
    // Auto-assign resolver audit table (populated by
    // UTL_stpRouteAutoAssign_ResolveOneSide). Consumed by the Auto-Assign Log
    // diagnostic page under `/auto-assign-log`.
    public virtual DbSet<RouteAutoAssignLog> RouteAutoAssignLogs { get; set; }

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

        // Driver Scheduling triggers (see audit 2026-09-10):
        //  - tucManualMessage_Insert : WOOP-spam filter, deletes msg body
        //      that matches "which has been dispatched to Courier"
        //  - TR_CourierScheduleResponse_Insert/_Update : overbooking guard,
        //      RAISERROR('Time Slot has already been filled.') when
        //      Wanted <= count(Available responses on slot).
        // Both must be declared so EF Core 10's MERGE + OUTPUT batching
        // falls back to the trigger-safe path or SaveChanges throws:
        // "The target table ... cannot have any enabled triggers if the
        // statement contains an OUTPUT clause without INTO clause".
        modelBuilder.Entity<TucManualMessage>(entity =>
        {
            entity.ToTable("tucManualMessage", t => t.HasTrigger("legacy_trigger"));
        });
        modelBuilder.Entity<CourierScheduleResponse>(entity =>
        {
            entity.ToTable("CourierScheduleResponse", t => t.HasTrigger("legacy_trigger"));
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
            // ViewZones read-side back-refs. The forward-facing HasOne(...)
            // .WithMany(x => x.<collection>).HasForeignKey(...) declarations
            // live on the child entity blocks (BulkZonePostcode, ZoneName)
            // below - declaring them here again would create duplicate
            // relationships and EF generates a shadow "TblBulkRegionBulkRegionId"
            // FK. The BulkZonePostcodeGroup collection is wired below in the
            // BulkZonePostcodeGroup block for the same reason.
        });

        // BulkZonePostcodeGroup: NZ rating-postcode group (spec sec. "NZ meaning").
        modelBuilder.Entity<BulkZonePostcodeGroup>(entity =>
        {
            entity.ToTable("BulkZonePostcodeGroup");
            entity.HasKey(e => e.Id);
            entity.HasOne(e => e.Depot)
                .WithMany(t => t.BulkZonePostcodeGroups)
                .HasForeignKey(e => e.DepotId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        // RouteAutoAssignLog: audit table populated by the resolver SP. We
        // never write to it from EF - reads only for the diagnostic page.
        modelBuilder.Entity<RouteAutoAssignLog>(entity =>
        {
            entity.ToTable("RouteAutoAssignLog");
            entity.HasKey(e => e.LogId);
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
            // BulkZoneSchedules + TblBulkScheduleLinehauls collections were
            // added in the Schedules partial. The reciprocal navs are:
            //   * BulkZoneSchedule.Schedule - wired below in the
            //     BulkZoneSchedule block (must reciprocate BOTH sides in
            //     ONE config or EF mints a shadow FK column
            //     TblBulkRunScheduleBulkRunScheduleId).
            //   * TblBulkScheduleLinehaul.BulkRunSchedule - wired here.
            // All other relations (Region, PickupDepot, Speeds,
            // PostcodeGroups, DropOff) get resolved via dictionary lookup
            // in ScheduleService rather than nav properties, matching
            // the pattern documented at line 268-280 above.
            entity.HasMany(s => s.TblBulkScheduleLinehauls)
                .WithOne(l => l.BulkRunSchedule)
                .HasForeignKey(l => l.BulkRunScheduleId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TblDropOffLocation>(entity =>
        {
            entity.HasKey(e => e.DropOffLocationId);
            entity.ToTable("tblDropOffLocation");
        });

        // Schedules module tables.
        // Header (2026-09-08 AddScheduleHeaderAndIdKeyedLinks): one row
        // per schedule group. PK column renamed 2026-09-09 from
        // BulkRunScheduleId to ScheduleId to remove the collision with
        // tblBulkRunSchedule.BulkRunScheduleId (day-row PK).
        modelBuilder.Entity<BulkRunScheduleHeader>(entity =>
        {
            entity.HasKey(e => e.ScheduleId);
        });
        // Day rows link to header via ScheduleId (day-row FK column,
        // renamed from BulkRunScheduleGroupId on 2026-09-09). Not to be
        // confused with the day-row's own BulkRunScheduleId PK.
        modelBuilder.Entity<TblBulkRunSchedule>(entity =>
        {
            entity.HasOne(e => e.Header)
                  .WithMany()
                  .HasForeignKey(e => e.ScheduleId)
                  .HasPrincipalKey(h => h.ScheduleId);
        });
        // Client link. Reshaped 2026-09-08 from ScheduleName to
        // BulkRunScheduleId; renamed to ScheduleId on 2026-09-09.
        modelBuilder.Entity<ScheduleClient>(entity =>
        {
            entity.HasKey(e => new { e.ScheduleId, e.ClientId });
            entity.HasOne(e => e.Header)
                  .WithMany()
                  .HasForeignKey(e => e.ScheduleId)
                  .HasPrincipalKey(h => h.ScheduleId);
        });
        // Postcode + polygon junctions still keyed on ScheduleName (out
        // of scope for this MR).
        modelBuilder.Entity<SchedulePostcode>(entity =>
        {
            entity.HasKey(e => new { e.ScheduleName, e.PostCode });
        });
        modelBuilder.Entity<SchedulePolygon>(entity =>
        {
            entity.HasKey(e => new { e.ScheduleName, e.PolygonId });
        });
        // Schedule Bundles (Dane's bundle-of-schedules concept, added
        // 2026-09-14 by AddBaseScheduleIdAndScheduleGroupTables and
        // renamed 2026-09-22 by RenameScheduleGroupToBundle). Bundle
        // header has an IDENTITY PK; member table is a composite
        // (BundleId, ScheduleId).
        modelBuilder.Entity<BulkRunScheduleBundle>(entity =>
        {
            entity.HasKey(e => e.BundleId);
        });
        modelBuilder.Entity<BulkRunScheduleBundleMember>(entity =>
        {
            entity.HasKey(e => new { e.BundleId, e.ScheduleId });
        });
        // Override delta table (Steve F1, 2026-09-22). Surrogate PK
        // OverrideId is IDENTITY; the useful lookup key is the clustered
        // index (ScheduleId, ClientId, Scope, LegOrdinal, DayOfWeek) which
        // SQL Server maintains via the CX_tblBulkRunScheduleOverride index
        // created in the migration. EF only sees the surrogate; the
        // service layer builds the lookup key via LINQ.
        modelBuilder.Entity<BulkRunScheduleOverride>(entity =>
        {
            entity.HasKey(e => e.OverrideId);
            entity.HasOne<BulkRunScheduleHeader>()
                  .WithMany()
                  .HasForeignKey(e => e.ScheduleId)
                  .HasPrincipalKey(h => h.ScheduleId);
        });
        // Header rowversion is a byte[] concurrency token. EF handles it
        // automatically thanks to [Timestamp] on the property; no fluent
        // config needed. Same for the new nullable string columns and
        // OverrideCount (int default 0).

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

            // Route <-> BulkRunPolygon many-to-many via the tblBulkRunPolygonRoute
            // junction (see migration 20260730100000_BulkPolygonAsCoverageStorage).
            entity.HasMany(r => r.BulkRunPolygons)
                .WithMany(p => p.Routes)
                .UsingEntity<Dictionary<string, object>>(
                    "BulkRunPolygonRoute",
                    j => j.HasOne<BulkRunPolygon>().WithMany()
                        .HasForeignKey("PolygonId")
                        .OnDelete(DeleteBehavior.Cascade)
                        .HasConstraintName("FK_tblBulkRunPolygonRoute_Polygon"),
                    j => j.HasOne<Despatch.Route>().WithMany()
                        .HasForeignKey("RouteId")
                        .OnDelete(DeleteBehavior.Cascade)
                        .HasConstraintName("FK_tblBulkRunPolygonRoute_Route"),
                    j =>
                    {
                        j.HasKey("RouteId", "PolygonId");
                        j.ToTable("tblBulkRunPolygonRoute");
                    });

            // Route <-> TblBulkRunSchedule many-to-many via the tblRouteSchedule
            // junction (see migration 20260803100000_RouteSchedulesManyToMany).
            // Replaces the legacy 1:1 Routes.ScheduleId pointer.
            entity.HasMany(r => r.Schedules)
                .WithMany(s => s.Routes)
                .UsingEntity<Dictionary<string, object>>(
                    "RouteSchedule",
                    j => j.HasOne<TblBulkRunSchedule>().WithMany()
                        .HasForeignKey("ScheduleId")
                        .OnDelete(DeleteBehavior.Cascade)
                        .HasConstraintName("FK_tblRouteSchedule_Schedule"),
                    j => j.HasOne<Despatch.Route>().WithMany()
                        .HasForeignKey("RouteId")
                        .OnDelete(DeleteBehavior.Cascade)
                        .HasConstraintName("FK_tblRouteSchedule_Route"),
                    j =>
                    {
                        j.HasKey("RouteId", "ScheduleId");
                        j.ToTable("tblRouteSchedule");
                    });
        });

        // BulkRunPolygon parent -> BulkRunPolygonPoint child (one point per row,
        // ordered by OrderIndex). FK stamped on the child via convention.
        modelBuilder.Entity<BulkRunPolygon>(entity =>
        {
            entity.HasMany(p => p.Points)
                .WithOne()
                .HasForeignKey(pt => pt.PolygonId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_tblBulkRunPolygonPoint_Polygon");
        });

        // BulkImportHyper port (Phase 1 Task 3 - 2026-07-22). Minimal config
        // only. Table names + primary keys, plus a handful of column-name
        // remaps where the Despatch DB uses ALL-CAPS suffixes that EF Core
        // would otherwise leave un-mapped. The full EF Power Tools scaffold
        // is deliberately trimmed here: reciprocal HasMany chains (e.g.
        // `HasOne(d => d.Client).WithMany(p => p.BulkImportSpeeds)`) are
        // NOT emitted because the RunBuilder-side TucClient / TucCourier /
        // TucJobType / TblBulkJob / TblBulkRegion / TblBulkRun /
        // TblBulkRunSchedule entities are slim variants without the
        // collection nav properties. EF Core's convention discovers the FK
        // by the `<Name>Id` column, which is enough for reads and writes
        // against the pre-existing DB schema. The full-fat scaffold can be
        // regenerated later if we ever unify the two halves.
        modelBuilder.Entity<BulkImportBatch>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("BulkImportBatch");
        });

        modelBuilder.Entity<BulkImportJobNumber>(entity =>
        {
            entity.HasKey(e => e.JobNumberId);
            entity.ToTable("BulkImportJobNumber");
            entity.Property(e => e.JobNumberId).ValueGeneratedNever().HasColumnName("JobNumberID");
            entity.Property(e => e.JobNumberName).HasMaxLength(255);
        });

        modelBuilder.Entity<BulkImportSpeed>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("BulkImportSpeed");
        });

        modelBuilder.Entity<BulkImportTemplate>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("BulkImportTemplate");
            entity.Property(e => e.Name).IsRequired().HasMaxLength(50);
        });

        modelBuilder.Entity<BulkImportTemplateMapping>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("BulkImportTemplateMapping");
            entity.Property(e => e.ImportField).IsRequired().HasMaxLength(50);
            entity.Property(e => e.UrgentField).IsRequired().HasMaxLength(50);
        });

        modelBuilder.Entity<BulkZonePostcode>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("BulkZonePostcode");
            entity.Property(e => e.FromLatLng).HasMaxLength(100);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(50);
        });

        modelBuilder.Entity<BulkZonePostcodeSurcharge>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("BulkZonePostcodeSurcharge");
            entity.Property(e => e.Surcharge).HasColumnType("money");
        });

        modelBuilder.Entity<BulkZoneSchedule>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("BulkZoneSchedule");
        });

        modelBuilder.Entity<JobDeliveryJourney>(entity =>
        {
            entity.HasKey(e => e.JourneyId);
            entity.ToTable("JobDeliveryJourney");
            entity.Property(e => e.JourneyId).HasColumnName("JourneyID");
            entity.Property(e => e.ChangeType).IsRequired().HasMaxLength(30);
            entity.Property(e => e.Comments).HasMaxLength(500);
            entity.Property(e => e.CourierId).HasColumnName("CourierID");
            entity.Property(e => e.FieldName).HasMaxLength(100);
            entity.Property(e => e.FlightId).HasColumnName("FlightID");
            entity.Property(e => e.JobId).HasColumnName("JobID");
            entity.Property(e => e.NewAgentId).HasColumnName("NewAgentID");
            entity.Property(e => e.NewCourierId).HasColumnName("NewCourierID");
            entity.Property(e => e.NewInternalStatusId).HasColumnName("NewInternalStatusID");
            entity.Property(e => e.NewJobStatusId).HasColumnName("NewJobStatusID");
            entity.Property(e => e.OldAgentId).HasColumnName("OldAgentID");
            entity.Property(e => e.OldCourierId).HasColumnName("OldCourierID");
            entity.Property(e => e.OldInternalStatusId).HasColumnName("OldInternalStatusID");
            entity.Property(e => e.OldJobStatusId).HasColumnName("OldJobStatusID");
            entity.Property(e => e.StaffId).HasColumnName("StaffID");
            entity.Property(e => e.UpdatedByType).IsRequired().HasMaxLength(20);
            entity.Ignore(e => e.Courier);
            entity.Ignore(e => e.Job);
            entity.Ignore(e => e.NewCourier);
            entity.Ignore(e => e.OldCourier);
            entity.Ignore(e => e.NewJobStatus);
            entity.Ignore(e => e.OldJobStatus);
        });

        modelBuilder.Entity<TblBulkJobNote>(entity =>
        {
            entity.HasKey(e => e.NoteId);
            entity.ToTable("tblBulkJobNotes");
            entity.Ignore(e => e.BulkJob);
        });

        modelBuilder.Entity<TblClientAvailableSpeed>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("tblClientAvailableSpeed");
        });

        modelBuilder.Entity<TblClientContact>(entity =>
        {
            entity.HasKey(e => e.ClientContactId);
            entity.ToTable("tblClientContact");
        });

        modelBuilder.Entity<TblClientDefaultAvailableSpeed>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("tblClientDefault_AvailableSpeed");
        });

        modelBuilder.Entity<TblGssstockSize>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("tblGSSStockSize");
        });

        modelBuilder.Entity<TblSite>(entity =>
        {
            entity.HasKey(e => e.SiteId);
            entity.ToTable("tblSite");
        });

        modelBuilder.Entity<TblbulkLinehaulRun>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("tblbulkLinehaulRun");
        });

        modelBuilder.Entity<TucClientContact>(entity =>
        {
            entity.HasKey(e => e.UcctId);
            entity.ToTable("tucClientContact");
        });

        modelBuilder.Entity<TucJob>(entity =>
        {
            entity.HasKey(e => e.UcjbId);
            entity.ToTable("tucJob", tb => tb.HasTrigger("legacy_trigger"));

            // Disambiguate the two TucSuburb navigations. TucSuburb has
            // reciprocal collections TucJobUcjbFromNavigations and
            // TucJobUcjbToNavigations - without an explicit pairing EF Core
            // fails model validation with "Unable to determine the
            // relationship represented by navigation ..." because the
            // reciprocal collection is not identifiable by convention.
            entity.HasOne(e => e.UcjbFromNavigation)
                .WithMany(p => p.TucJobUcjbFromNavigations)
                .HasForeignKey(e => e.UcjbFrom)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.UcjbToNavigation)
                .WithMany(p => p.TucJobUcjbToNavigations)
                .HasForeignKey(e => e.UcjbTo)
                .OnDelete(DeleteBehavior.NoAction);

            // UcjbStatusNavigation pairs with TucJobStatus.TucJobs.
            entity.HasOne(e => e.UcjbStatusNavigation)
                .WithMany(p => p.TucJobs)
                .HasForeignKey(e => e.UcjbStatus)
                .OnDelete(DeleteBehavior.NoAction);

            // Contact -> TucClientContact.TucJobs. Explicit pairing so EF
            // does not try to match the TucClientContact.TucJobBookings
            // collection to this nav.
            entity.HasOne(e => e.Contact)
                .WithMany(p => p.TucJobs)
                .HasForeignKey(e => e.ContactId)
                .OnDelete(DeleteBehavior.NoAction);

            // TucClient / TucCourier / TucJobType are slim in the RunBuilder
            // half of this codebase (no back-ref collections). Explicit
            // WithMany() with no collection selector tells EF the target
            // side is intentionally without a reciprocal. TucJob has THREE
            // navs to TucCourier and FOUR to TucJobType so these must be
            // spelled out or EF cannot pair the FK to each nav.
            entity.HasOne(e => e.UcjbClient)
                .WithMany()
                .HasForeignKey(e => e.UcjbClientId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.UcjbCourier)
                .WithMany()
                .HasForeignKey(e => e.UcjbCourierId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.Fdcourier)
                .WithMany()
                .HasForeignKey(e => e.FdcourierId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.MasterCourier)
                .WithMany()
                .HasForeignKey(e => e.MasterCourierId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.UcjbSpeedNavigation)
                .WithMany()
                .HasForeignKey(e => e.UcjbSpeed)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.AcceptedJobType)
                .WithMany()
                .HasForeignKey(e => e.AcceptedJobTypeId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.DesiredJobType)
                .WithMany()
                .HasForeignKey(e => e.DesiredJobTypeId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.NotifiedJobType)
                .WithMany()
                .HasForeignKey(e => e.NotifiedJobTypeId)
                .OnDelete(DeleteBehavior.NoAction);

            // TucNotes collection points at TucNote.Job (FK JobId).
            entity.HasMany(e => e.TucNotes)
                .WithOne(p => p.Job)
                .HasForeignKey(p => p.JobId)
                .OnDelete(DeleteBehavior.NoAction);

            // JobDeliveryJourney navs are all Ignored on the child entity,
            // so also drop the reciprocal collection here to keep EF from
            // trying to pair it against a phantom back-ref.
            entity.Ignore(e => e.JobDeliveryJourneys);
        });

        modelBuilder.Entity<TucJobBooking>(entity =>
        {
            entity.HasKey(e => e.UcbkId);
            entity.ToTable("tucJobBooking", tb => tb.HasTrigger("legacy_trigger"));

            // LoggedInContact -> TucClientContact.TucJobBookings.
            entity.HasOne(e => e.LoggedInContact)
                .WithMany(p => p.TucJobBookings)
                .HasForeignKey(e => e.LoggedInContactId)
                .OnDelete(DeleteBehavior.NoAction);

            // Self-referential BookingParent / InverseBookingParent.
            entity.HasOne(e => e.BookingParent)
                .WithMany(p => p.InverseBookingParent)
                .HasForeignKey(e => e.BookingParentId)
                .OnDelete(DeleteBehavior.NoAction);

            // Slim TucClient / TucCourier / TucJobType have no back-ref
            // collections - explicit WithMany() empty.
            entity.HasOne(e => e.UcbkClient)
                .WithMany()
                .HasForeignKey(e => e.UcbkClientId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.Courier)
                .WithMany()
                .HasForeignKey(e => e.CourierId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.UcbkSpeedNavigation)
                .WithMany()
                .HasForeignKey(e => e.UcbkSpeed)
                .OnDelete(DeleteBehavior.NoAction);

            // TucNotes collection points at TucNote.JobBooking (FK JobBookingId).
            entity.HasMany(e => e.TucNotes)
                .WithOne(p => p.JobBooking)
                .HasForeignKey(p => p.JobBookingId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<TucJobStatus>(entity =>
        {
            entity.HasKey(e => e.UcjsId);
            entity.ToTable("tucJobStatus");

            // TucJobs collection is paired to TucJob.UcjbStatusNavigation
            // above. TblBulkJob has a JobStatusNavigation nav (see
            // TblBulkJob.BulkImport.cs partial) which pairs to
            // TucJobStatus.TblBulkJobs via the TblBulkJob.JobStatus FK.
            entity.HasMany(e => e.TblBulkJobs)
                .WithOne(p => p.JobStatusNavigation)
                .HasForeignKey(p => p.JobStatus)
                .OnDelete(DeleteBehavior.NoAction);

            // JobDeliveryJourney relationships are Ignored on the child;
            // drop the reciprocal collections so EF does not try to bind
            // them.
            entity.Ignore(e => e.JobDeliveryJourneyNewJobStatuses);
            entity.Ignore(e => e.JobDeliveryJourneyOldJobStatuses);
        });

        modelBuilder.Entity<TucNote>(entity =>
        {
            entity.HasKey(e => e.NoteId);
            entity.ToTable("tucNote");
            // NoteType is unambiguous - lone nav on TucNote side and lone
            // TucNotes collection on TucNoteType side, EF resolves by
            // convention. Job / JobBooking are wired from the parent
            // entities (TucJob / TucJobBooking) above.
        });

        modelBuilder.Entity<TucNoteType>(entity =>
        {
            entity.HasKey(e => e.NoteTypeId);
            entity.ToTable("tucNoteType");

            // TblBulkJobNote.NoteType is one-of-two navs on that entity
            // (BulkJob + NoteType). Wire the reciprocal collection so EF
            // pairs it correctly.
            entity.HasMany(e => e.TblBulkJobNotes)
                .WithOne(p => p.NoteType)
                .HasForeignKey(p => p.NoteTypeId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<TucSuburb>(entity =>
        {
            entity.HasKey(e => e.UcsuId);
            entity.ToTable("tucSuburb");

            // TblSite.AirportSuburb pairs with TucSuburb.TblSites.
            entity.HasMany(e => e.TblSites)
                .WithOne(p => p.AirportSuburb)
                .HasForeignKey(p => p.AirportSuburbId)
                .OnDelete(DeleteBehavior.NoAction);

            // TucClient.UcclSuburb pairs with TucSuburb.TucClients.
            entity.HasMany(e => e.TucClients)
                .WithOne(p => p.UcclSuburb)
                .HasForeignKey(p => p.UcclSuburbId)
                .OnDelete(DeleteBehavior.NoAction);
            // TucJobUcjb{From,To}Navigations wired from TucJob above.
        });

        modelBuilder.Entity<TucClientContact>(entity =>
        {
            entity.HasKey(e => e.UcctId);
            entity.ToTable("tucClientContact");

            // UcctClient -> TucClient (slim, no back-ref).
            entity.HasOne(e => e.UcctClient)
                .WithMany()
                .HasForeignKey(e => e.UcctClientId)
                .OnDelete(DeleteBehavior.NoAction);

            // TblClientContact.Contact -> TucClientContact.TblClientContacts.
            entity.HasMany(e => e.TblClientContacts)
                .WithOne(p => p.Contact)
                .HasForeignKey(p => p.ContactId)
                .OnDelete(DeleteBehavior.NoAction);

            // BulkImport* -> TucClientContact reciprocal collections.
            entity.HasMany(e => e.BulkImportBatches)
                .WithOne(p => p.Contact)
                .HasForeignKey(p => p.ContactId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasMany(e => e.BulkImportTemplates)
                .WithOne(p => p.Contact)
                .HasForeignKey(p => p.ContactId)
                .OnDelete(DeleteBehavior.NoAction);
            // TucJobs + TucJobBookings collections wired from parent entities.
        });

        modelBuilder.Entity<TblClientContact>(entity =>
        {
            // Row already registered via HasKey above; augment with the
            // Client (TucClient - slim) nav so EF has an FK for it.
            entity.HasOne(e => e.Client)
                .WithMany(p => p.TblClientContacts)
                .HasForeignKey(e => e.ClientId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<TblSite>(entity =>
        {
            // AirportSuburb wired from TucSuburb above.
            entity.HasOne(e => e.DefaultDeliveryClient)
                .WithMany()
                .HasForeignKey(e => e.DefaultDeliveryClientId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.DefaultPickupClient)
                .WithMany()
                .HasForeignKey(e => e.DefaultPickupClientId)
                .OnDelete(DeleteBehavior.NoAction);
            // TucClients (many-to-many via legacy junction) has no back-ref
            // on our slim TucClient. Drop it; the wizard does not need it.
            entity.Ignore(e => e.TucClients);
        });

        modelBuilder.Entity<TblbulkLinehaulRun>(entity =>
        {
            // Two navs to slim TblBulkRegion (FromDepot / ToDepot) - each
            // needs its own explicit HasOne so EF can pin the FK.
            entity.HasOne(e => e.FromDepot)
                .WithMany()
                .HasForeignKey(e => e.FromDepotId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.ToDepot)
                .WithMany()
                .HasForeignKey(e => e.ToDepotId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Courier)
                .WithMany()
                .HasForeignKey(e => e.CourierId)
                .OnDelete(DeleteBehavior.NoAction);
            // Reciprocal collection to TblBulkScheduleLinehaul. Without this
            // explicit config EF Core auto-creates a shadow FK column named
            // "TblbulkLinehaulRunId" (derived from the principal type name)
            // which doesn't exist in the DB. The real FK column is
            // "LinehaulRunID" (mapped on the child as LinehaulRunId in
            // Entities.BulkImport.cs). Pin it here so queries against
            // tblBulkScheduleLinehaul don't try to select a phantom column.
            entity.HasMany(e => e.TblBulkScheduleLinehauls)
                .WithOne()
                .HasForeignKey(l => l.LinehaulRunId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<TblBulkJobNote>(entity =>
        {
            // BulkJob -> TblBulkJob (slim). Already Ignored above.
            // NoteType wired from TucNoteType above.
        });

        modelBuilder.Entity<TblClientAvailableSpeed>(entity =>
        {
            entity.HasOne(e => e.Client)
                .WithMany()
                .HasForeignKey(e => e.ClientId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Speed)
                .WithMany()
                .HasForeignKey(e => e.SpeedId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<TblClientDefaultAvailableSpeed>(entity =>
        {
            entity.HasOne(e => e.Speed)
                .WithMany()
                .HasForeignKey(e => e.SpeedId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<BulkImportBatch>(entity =>
        {
            // Contact wired from TucClientContact above.
            // TblBulkJobs collection pairs with TblBulkJob.Import (FK ImportId).
            entity.HasMany(e => e.TblBulkJobs)
                .WithOne(p => p.Import)
                .HasForeignKey(p => p.ImportId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<BulkImportTemplate>(entity =>
        {
            // Contact wired from TucClientContact above.
            entity.HasMany(e => e.BulkImportTemplateMappings)
                .WithOne(p => p.Template)
                .HasForeignKey(p => p.TemplateId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<BulkImportSpeed>(entity =>
        {
            entity.HasOne(e => e.Client)
                .WithMany()
                .HasForeignKey(e => e.ClientId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Speed)
                .WithMany()
                .HasForeignKey(e => e.SpeedId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<BulkZonePostcodeSurcharge>(entity =>
        {
            entity.HasOne(e => e.Client)
                .WithMany()
                .HasForeignKey(e => e.ClientId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<BulkZonePostcode>(entity =>
        {
            entity.HasOne(e => e.Depot)
                .WithMany(d => d.BulkZonePostcodes)
                .HasForeignKey(e => e.DepotId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.PostcodeGroup)
                .WithMany(g => g.BulkZonePostcodes)
                .HasForeignKey(e => e.PostcodeGroupId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<BulkZoneSchedule>(entity =>
        {
            // Reciprocate the TblBulkRunSchedule.BulkZoneSchedules collection
            // that the Schedules partial declares. Without the lambda on
            // WithMany(...), EF sees two overlapping configs (this one and the
            // implicit convention pickup from the named collection) and mints
            // a shadow FK "TblBulkRunScheduleBulkRunScheduleId" that does not
            // exist in the DB. Explicit lambda on both sides pins one
            // relationship. OnDelete stays NoAction (previous behaviour);
            // deleting a schedule via ScheduleService.DeleteAsync clears the
            // zone rows via explicit RemoveRange before SaveChangesAsync.
            entity.HasOne(e => e.Schedule)
                .WithMany(s => s.BulkZoneSchedules)
                .HasForeignKey(e => e.ScheduleId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<TblBulkJob>(entity =>
        {
            // Additional BulkImport-partial navs on the slim TblBulkJob:
            // SpeedNavigation / Courier / JobStatusNavigation / Import.
            entity.HasOne(e => e.SpeedNavigation)
                .WithMany()
                .HasForeignKey(e => e.Speed)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Courier)
                .WithMany()
                .HasForeignKey(e => e.CourierId)
                .OnDelete(DeleteBehavior.NoAction);
            // JobStatusNavigation + Import wired from TucJobStatus /
            // BulkImportBatch entity blocks above.
        });

        modelBuilder.Entity<ZoneCombo>(entity =>
        {
            entity.HasKey(e => e.ZoneComboId);
            entity.ToTable("ZoneCombo");

            // ZoneCombo has TWO navs to ZoneName (FromZoneName / ToZoneName)
            // and ZoneName has reciprocal collections
            // ZoneComboFromZoneNames / ZoneComboToZoneNames. Same class of
            // ambiguity as TucJob <-> TucSuburb; explicit pairing required.
            entity.HasOne(e => e.FromZoneName)
                .WithMany(p => p.ZoneComboFromZoneNames)
                .HasForeignKey(e => e.FromZoneNameId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.ToZoneName)
                .WithMany(p => p.ZoneComboToZoneNames)
                .HasForeignKey(e => e.ToZoneNameId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Speed)
                .WithMany()
                .HasForeignKey(e => e.SpeedId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<ZoneGroup>(entity =>
        {
            entity.HasKey(e => e.ZoneGroupId);
            entity.ToTable("ZoneGroup");
        });

        modelBuilder.Entity<ZoneName>(entity =>
        {
            entity.HasKey(e => e.ZoneNameId);
            entity.ToTable("ZoneName");
            // Actual column on DFRNT is "ZoneName" (same as the table). The
            // Power Tools scaffold renamed the CLR property to ZoneName1 to
            // avoid class/property collision, but did NOT emit a column
            // mapping. Without this, EF generates SELECT ZoneName1 and the
            // server returns "Invalid column name 'ZoneName1'" (500 on
            // GET /api/address/zipcodes and any other consumer).
            entity.Property(e => e.ZoneName1).HasColumnName("ZoneName");
            // Location -> TblBulkRegion. ZoneNames back-ref surfaced 2026-08-03
            // for the Polygon Builder VIEW Zones drawer.
            entity.HasOne(e => e.Location)
                .WithMany(t => t.ZoneNames)
                .HasForeignKey(e => e.LocationId)
                .OnDelete(DeleteBehavior.NoAction);
            // ZoneComboFrom/To collections wired from ZoneCombo above.
        });

        modelBuilder.Entity<ZoneZip>(entity =>
        {
            entity.HasKey(e => e.ZoneZipId);
            entity.ToTable("ZoneZip");
            entity.HasOne(e => e.ZoneName)
                .WithMany(p => p.ZoneZips)
                .HasForeignKey(e => e.ZoneNameId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
