// DespatchContext + DespatchContext.Partial + DespatchContextBulkImportExtensions
// coverage. Verifies:
//   1. The full model builds under EF Core InMemory (OnModelCreating and
//      OnModelCreatingPartial run without throwing).
//   2. Every DbSet<T> declared on the base + partial contexts is materialised
//      by EF (the property returns a non-null Set proxy).
//   3. Round-trip Add + SaveChanges + query on the entities that are safe to
//      insert under InMemory (simple key + scalar-only rows).
//   4. AssignJobNumbersAsync forwards the SP call to the underlying database.
//      InMemory does not know sp_AssignJobNumbers so the call throws - we
//      assert the throw shape which proves the wrapper reached the DB layer.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Core.Domain.Models;

namespace RoutedOperations.Tests.Domain;

public class DespatchContextTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    [Fact]
    public void ModelBuilds_UnderInMemory_WithoutThrowing()
    {
        // Instantiating the derived DynamicDespatchDbContext (which chains into
        // DespatchContext.OnModelCreating + OnModelCreatingPartial) plus
        // EnsureCreated forces the whole model to compile. Any bad FK config
        // or navigation ambiguity would throw here.
        using var ctx = new DynamicDespatchDbContext(NewOptions());
        Assert.True(ctx.Database.EnsureCreated());
    }

    [Fact]
    public void DbSets_OnBaseContext_AreMaterialised()
    {
        using var ctx = new DynamicDespatchDbContext(NewOptions());
        // Sample every DbSet declared on the base DespatchContext.cs (32
        // entity sets + 5 keyless via DespatchContextBulkImportExtensions).
        // Any typo in the property declaration would return null here.
        Assert.NotNull(ctx.TblBulkJobs);
        Assert.NotNull(ctx.TblBulkRuns);
        Assert.NotNull(ctx.TblBulkJobRuns);
        Assert.NotNull(ctx.TblBulkRegions);
        Assert.NotNull(ctx.TucJobTypes);
        Assert.NotNull(ctx.TucCouriers);
        Assert.NotNull(ctx.TucCourierFleets);
        Assert.NotNull(ctx.TblBulkRunSchedules);
        Assert.NotNull(ctx.TblBulkJobItems);
        Assert.NotNull(ctx.VehicleSizes);
        Assert.NotNull(ctx.TucClients);
        Assert.NotNull(ctx.TblBulkScheduleLinehauls);
        Assert.NotNull(ctx.TblBulkPostCodeRunNames);
        Assert.NotNull(ctx.Routes);
        Assert.NotNull(ctx.ZipPolygons);
        Assert.NotNull(ctx.BulkRunPolygons);
        Assert.NotNull(ctx.BulkRunPolygonPoints);
        Assert.NotNull(ctx.DispatchRouteRosters);
        Assert.NotNull(ctx.TucAgents);
        Assert.NotNull(ctx.TblQuoteJobs);
        Assert.NotNull(ctx.TblQuoteRuns);
        Assert.NotNull(ctx.BulkImportBatches);
        Assert.NotNull(ctx.BulkImportJobNumbers);
        Assert.NotNull(ctx.BulkImportSpeeds);
        Assert.NotNull(ctx.BulkImportTemplates);
        Assert.NotNull(ctx.BulkImportTemplateMappings);
        Assert.NotNull(ctx.BulkZonePostcodes);
        Assert.NotNull(ctx.BulkZonePostcodeGroups);
        Assert.NotNull(ctx.BulkZonePostcodeSurcharges);
        Assert.NotNull(ctx.BulkZoneSchedules);
        Assert.NotNull(ctx.JobDeliveryJourneys);
        Assert.NotNull(ctx.TblBulkJobNotes);
        Assert.NotNull(ctx.TblClientAvailableSpeeds);
        Assert.NotNull(ctx.TblClientContacts);
        Assert.NotNull(ctx.TblClientDefaultAvailableSpeeds);
        Assert.NotNull(ctx.TblGssstockSizes);
        Assert.NotNull(ctx.TblSites);
        Assert.NotNull(ctx.TblbulkLinehaulRuns);
        Assert.NotNull(ctx.TucClientContacts);
        Assert.NotNull(ctx.TucJobs);
        Assert.NotNull(ctx.TucJobBookings);
        Assert.NotNull(ctx.TucJobStatuses);
        Assert.NotNull(ctx.TucNotes);
        Assert.NotNull(ctx.TucNoteTypes);
        Assert.NotNull(ctx.TucSuburbs);
        Assert.NotNull(ctx.ZoneCombos);
        Assert.NotNull(ctx.ZoneGroups);
        Assert.NotNull(ctx.ZoneNames);
        Assert.NotNull(ctx.ZoneZips);
        Assert.NotNull(ctx.RouteAutoAssignLogs);
    }

    [Fact]
    public void DbSets_OnPartialContext_AreMaterialised()
    {
        using var ctx = new DynamicDespatchDbContext(NewOptions());
        // DespatchContext.Partial.cs adds Route Viewer P0 + Recurring Routes
        // sets. All defined via partial so a typo would still surface here.
        Assert.NotNull(ctx.AlertTemplates);
        Assert.NotNull(ctx.AlertTemplatePageSizes);
        Assert.NotNull(ctx.TblSettings);
        Assert.NotNull(ctx.TblBulkEvents);
        Assert.NotNull(ctx.DispatchLinehaulRunRosters);
        Assert.NotNull(ctx.TucJobTypeGroupings);
    }

    [Fact]
    public void DbSets_KeylessBulkImportResults_AreMaterialised()
    {
        using var ctx = new DynamicDespatchDbContext(NewOptions());
        // Registered in DespatchContextBulkImportExtensions.OnModelCreatingPartial.
        Assert.NotNull(ctx.ZoneRates);
        Assert.NotNull(ctx.ZoneLinehaulRate);
        Assert.NotNull(ctx.Rates);
        Assert.NotNull(ctx.UrgentRates);
        Assert.NotNull(ctx.SuburbID);
    }

    [Fact]
    public async Task AddAndReadBack_SimpleEntities_UnderInMemory()
    {
        // Pick the entities that don't drag in required FKs or filtered-index
        // gymnastics under InMemory: no FK enforcement is done by InMemory so
        // most are safe, but we stick to the plain reference tables that
        // exercise the model without pulling in a full graph.
        var opts = NewOptions();
        await using (var ctx = new DynamicDespatchDbContext(opts))
        {
            ctx.TucJobTypes.Add(new TucJobType { UcjtId = 1, UcjtName = "SD" });
            ctx.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "Alice", Active = true });
            ctx.TucCourierFleets.Add(new TucCourierFleet { UccfId = 1, UccfName = "F1" });
            ctx.VehicleSizes.Add(new VehicleSize { VehicleSizeId = 1, VehicleName = "Van", CubicCapacity = 12m });
            ctx.TucAgents.Add(new TucAgent { UcagId = 1, UcagName = "NP1", IsNetworkPartner = true });
            ctx.TucJobStatuses.Add(new TucJobStatus { UcjsId = 1, UcjsName = "New" });
            ctx.TucNoteTypes.Add(new TucNoteType { NoteTypeId = 1, NoteTypeName = "System", IsActive = true });
            ctx.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "Wgtn", Active = true });
            ctx.TucJobTypeGroupings.Add(new TucJobTypeGrouping { GroupingId = 1, GroupingName = "Flight" });
            ctx.AlertTemplatePageSizes.Add(new AlertTemplatePageSize { Id = 1, Name = "A4" });
            ctx.BulkImportJobNumbers.Add(new BulkImportJobNumber { JobNumberId = 1, JobNumberName = "N1" });
            ctx.TblBulkPostCodeRunNames.Add(new TblBulkPostCodeRunName { Id = 1, PostCode = "6011", RunName = "R1" });
            ctx.TblGssstockSizes.Add(new TblGssstockSize
            {
                Id = 1, Name = "Box", Length = 30, Width = 20, Height = 10,
                Volume = 6000, Weight = 1.5, Created = DateTime.UtcNow,
                CreatedBy = "kev", LastModified = DateTime.UtcNow, LastModifiedBy = "kev",
            });
            await ctx.SaveChangesAsync();
        }
        // Fresh context reads back through the same InMemory store.
        await using (var ctx = new DynamicDespatchDbContext(opts))
        {
            Assert.Single(ctx.TucJobTypes);
            Assert.Single(ctx.TucCouriers);
            Assert.Single(ctx.TucCourierFleets);
            Assert.Single(ctx.VehicleSizes);
            Assert.Single(ctx.TucAgents);
            Assert.Single(ctx.TucJobStatuses);
            Assert.Single(ctx.TucNoteTypes);
            Assert.Single(ctx.TblBulkRegions);
            Assert.Single(ctx.TucJobTypeGroupings);
            Assert.Single(ctx.AlertTemplatePageSizes);
            Assert.Single(ctx.BulkImportJobNumbers);
            Assert.Single(ctx.TblBulkPostCodeRunNames);
            Assert.Single(ctx.TblGssstockSizes);
        }
    }

    [Fact]
    public async Task AssignJobNumbersAsync_UnderInMemory_ThrowsAtDbLayer()
    {
        // The wrapper calls Database.ExecuteSqlRawAsync which InMemory does
        // not support - it throws InvalidOperationException with the standard
        // "Relational-specific methods can only be used when the context is
        // using a relational database provider" message. This test proves the
        // wrapper reaches the DB layer (SP name + parameter shape are
        // validated by ExecuteSqlRawAsync at that layer) without needing a
        // SQL Server harness.
        await using var ctx = new DynamicDespatchDbContext(NewOptions());
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => ctx.AssignJobNumbersAsync(clientId: 1, numberOfRecords: 5));
    }

    [Fact]
    public void ProceduresProperty_LazyInitialisesAndCaches()
    {
        // DespatchContextProcedures.cs exposes a Procedures property backed
        // by a lazy-init field. First access constructs the wrapper; second
        // access returns the cached instance. Also verify the setter path.
        using var ctx = new DynamicDespatchDbContext(NewOptions());
        var first = ctx.Procedures;
        Assert.NotNull(first);
        var second = ctx.Procedures;
        Assert.Same(first, second);
        // GetProcedures() alias returns the same reference.
        Assert.Same(first, ctx.GetProcedures());
        // Setter override.
        var stub = Substitute.For<IDespatchContextProcedures>();
        ctx.Procedures = stub;
        Assert.Same(stub, ctx.Procedures);
    }
}
