// Cross-client refusals and commercial-field stripping for customers in Bulk
// Import (ro-bulk-import-customer-scope M2).
//
// Each gap closed here was open in the port AND in legacy BulkImportHyper:
// a customer who edited a request could price, book, void or read schedules
// for another client, or set their own price and courier. The rule these
// encode is Steve's 2026-09-30 ruling: a customer only acts on jobs and rates
// for their own clients, and Bulk Import prices at the client's rates (or the
// defaults), never at a price the customer sends. Staff are unchanged.
//
// Seed (BulkClientScopeTests.SeedClients): contact 7 acts for 100 and 101;
// 200 belongs to someone else.
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Clients;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.BulkImport;

public class BulkImportCustomerScopeTests
{
    private const int Contact = BulkClientScopeTests.Contact;
    private const string Customer = "2";
    private const string Staff = "4";

    private static BulkImportServiceV2 Svc(out DynamicDespatchDbContext seed, string clientTypeId)
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out seed, out _, countryCode: "NZ", clientTypeId: clientTypeId);
        BulkClientScopeTests.SeedClients(seed);
        return svc;
    }

    private static PickupJobRequest Pickup(int clientId) => new()
    {
        NumberOfVehicle = 1,
        VehicleSize = "Car",
        PickupJob = new PickupJobToCreateDto
        {
            ClientID = clientId,
            Time = DateTime.Now.AddDays(1),
            Quantity = 1,
            Weight = "1",
            FixedAmount = 99f,
            AgentAmount = 50f,
            AgentCourierID = 12,
            FuelSurchargeAmount = 5f,
        }
    };

    private static async Task RunIgnoringProviderFailure(Func<Task> call)
    {
        try { await call(); } catch (Exception) { /* raw SQL is not supported by InMemory */ }
    }

    private static void AssertRefused(BaseResponse r, string message)
    {
        Assert.False(r.Success);
        Assert.Contains(r.Messages, m => m.Message == message);
    }

    // ---------------- G1 / G2 pickup rate and book -----------------

    [Fact]
    public async Task Customer_cannot_price_a_pickup_for_another_client()
    {
        // Refused before WS_stpJobType_Rates: InMemory would throw if the SP ran.
        var svc = Svc(out _, Customer);
        AssertRefused(await svc.GetPickupRate(Contact, Pickup(200)), "Invalid client.");
    }

    [Fact]
    public async Task Customer_cannot_book_a_pickup_for_another_client()
    {
        var svc = Svc(out _, Customer);
        var resp = await svc.BookPickup(Contact, Pickup(200));
        AssertRefused(resp, "Invalid client.");
        Assert.Empty(resp.JobId);
    }

    [Fact]
    public async Task Customer_pickup_for_own_client_reaches_booking_without_their_own_price_or_agent()
    {
        var svc = Svc(out _, Customer);
        var req = Pickup(100);
        // The scope check passes and the fields are stripped before
        // WS_stpJob_Insert is reached (the InMemory provider cannot run it, so
        // whatever it does with the call is irrelevant here).
        await RunIgnoringProviderFailure(() => svc.BookPickup(Contact, req));
        Assert.Null(req.PickupJob.FixedAmount);
        Assert.Null(req.PickupJob.AgentAmount);
        Assert.Null(req.PickupJob.AgentCourierID);
        Assert.Null(req.PickupJob.FuelSurchargeAmount);
    }

    [Fact]
    public async Task Staff_pickup_keeps_the_amounts_they_send()
    {
        var svc = Svc(out _, Staff);
        var req = Pickup(200);
        await RunIgnoringProviderFailure(() => svc.BookPickup(Contact, req));
        Assert.Equal(99f, req.PickupJob.FixedAmount);
        Assert.Equal(12, req.PickupJob.AgentCourierID);
    }

    // ---------------- G3 void on-demand -----------------

    private static void SeedJob(DynamicDespatchDbContext seed, int id, int clientId, int? sourceId = 3, int? parentId = null)
    {
        seed.TucJobs.Add(new TucJob { UcjbId = id, UcjbNumber = $"J{id}", UcjbStatus = 0, UcjbClientId = clientId, SourceId = sourceId, ParentId = parentId });
        seed.SaveChanges();
    }

    private static async Task<bool> IsVoid(DynamicDespatchDbContext seed, int id)
    {
        var job = seed.TucJobs.Find(id)!;
        await seed.Entry(job).ReloadAsync();
        return job.UcjbVoid;
    }

    [Fact]
    public async Task Customer_cannot_void_another_clients_job_and_nothing_is_written()
    {
        var svc = Svc(out var seed, Customer);
        SeedJob(seed, 10, clientId: 200);

        AssertRefused(await svc.DeleteTucJob(Contact, new IdRequest { Id = 10 }), "Job not found.");
        Assert.False(await IsVoid(seed, 10));
    }

    [Fact]
    public async Task Customer_cannot_void_their_own_clients_job_that_did_not_come_from_bulk_import()
    {
        // A job booked through the website or API (SourceId <> 3) is not on
        // the Bulk Import list, so Bulk Import may not void it.
        var svc = Svc(out var seed, Customer);
        SeedJob(seed, 11, clientId: 100, sourceId: 1);

        AssertRefused(await svc.DeleteTucJob(Contact, new IdRequest { Id = 11 }), "Job not found.");
        Assert.False(await IsVoid(seed, 11));
    }

    [Fact]
    public async Task Customer_void_is_refused_whole_when_a_child_belongs_to_another_client()
    {
        var svc = Svc(out var seed, Customer);
        SeedJob(seed, 12, clientId: 100);
        SeedJob(seed, 13, clientId: 200, parentId: 12);

        AssertRefused(await svc.DeleteTucJob(Contact, new IdRequest { Id = 12 }), "Job not found.");
        Assert.False(await IsVoid(seed, 12));
        Assert.False(await IsVoid(seed, 13));
    }

    [Fact]
    public async Task Customer_can_void_their_own_bulk_import_job()
    {
        var svc = Svc(out var seed, Customer);
        SeedJob(seed, 14, clientId: 101);

        Assert.True((await svc.DeleteTucJob(Contact, new IdRequest { Id = 14 })).Success);
        Assert.True(await IsVoid(seed, 14));
    }

    [Fact]
    public async Task Staff_can_still_void_any_job()
    {
        var svc = Svc(out var seed, Staff);
        SeedJob(seed, 15, clientId: 200, sourceId: 1);

        Assert.True((await svc.DeleteTucJob(Contact, new IdRequest { Id = 15 })).Success);
        Assert.True(await IsVoid(seed, 15));
    }

    // ---------------- Import: client and commercial fields -----------------

    private static BulkImportRequest ImportRequest(int clientId, bool asCompleted = false) => new()
    {
        ClientId = clientId,
        SpeedId = 1,
        BookDate = DateTime.Now.AddDays(5),
        JobType = "ondemand",
        ImportAsCompleted = asCompleted,
        Jobs =
        [
            new() { JobNumber = "J1", ToAddress = "T", ToContact = "C", Amount = 1m, CourierPercentageOverride = 0.9m, CourierCode = "C1", CourierId = 5 }
        ]
    };

    [Fact]
    public async Task Customer_cannot_import_for_another_client()
    {
        var svc = Svc(out _, Customer);
        AssertRefused(await svc.Import(Contact, ImportRequest(200)), "Invalid client.");
    }

    [Fact]
    public async Task Customer_import_drops_their_price_courier_percentage_and_courier()
    {
        // Stripping runs before anything reads the rows, so the request shows
        // what the rest of Import (and the rating functions) would see.
        var svc = Svc(out _, Customer);
        var req = ImportRequest(200);
        await svc.Import(Contact, req);

        var job = req.Jobs!.Single();
        Assert.Null(job.Amount);
        Assert.Null(job.CourierPercentageOverride);
        Assert.Null(job.CourierCode);
        Assert.Null(job.CourierId);
    }

    [Fact]
    public async Task Customer_import_as_completed_is_allowed_but_the_courier_is_dropped()
    {
        // Import as Completed stays open for customers pending Steve; picking
        // the courier (driver pay) does not.
        var svc = Svc(out _, Customer);
        var req = ImportRequest(200, asCompleted: true);
        await svc.Import(Contact, req);

        Assert.True(req.ImportAsCompleted);
        Assert.Null(req.Jobs!.Single().CourierCode);
    }

    [Fact]
    public async Task Staff_import_keeps_price_and_courier()
    {
        var svc = Svc(out _, Staff);
        var req = ImportRequest(999, asCompleted: true);
        await svc.Import(Contact, req);

        var job = req.Jobs!.Single();
        Assert.Equal(1m, job.Amount);
        Assert.Equal(0.9m, job.CourierPercentageOverride);
        Assert.Equal("C1", job.CourierCode);
    }

    // ---------------- ClientService -----------------

    private static ClientService Clients(out DynamicDespatchDbContext seed, string clientTypeId)
    {
        var opts = BulkImportTestHarness.NewOptions();
        seed = BulkImportTestHarness.Context(opts);
        BulkClientScopeTests.SeedClients(seed);
        var accessor = BulkImportTestHarness.Accessor("NZ", clientTypeId);
        return new ClientService(BulkImportTestHarness.Factory(opts), accessor, BulkImportTestHarness.Cache(accessor), new BulkClientScope(accessor));
    }

    [Fact]
    public async Task Customer_cannot_read_another_clients_schedules()
    {
        // Ported from legacy with the refusal's result thrown away, so it
        // carried on and returned the schedules anyway.
        var svc = Clients(out _, Customer);
        var resp = await svc.GetSchedulesByBookDate(Contact, new SchedulesByBookDateRequest
        {
            ClientId = 200, BookDate = DateTime.SpecifyKind(DateTime.Now.AddDays(1), DateTimeKind.Local), SpeedId = 1
        });
        AssertRefused(resp, "Invalid client.");
        Assert.Null(resp.Schedules);
    }

    [Fact]
    public async Task Customer_client_lists_only_hold_their_active_linked_clients()
    {
        var svc = Clients(out _, Customer);
        var mine = await svc.Get(Guid.NewGuid(), Contact);
        Assert.Equal(new[] { 100, 101 }, mine.Clients.Select(c => c.Id).OrderBy(i => i).ToArray());

        var search = await svc.Search(Guid.NewGuid(), Contact, "o");  // matches "Other" too
        Assert.DoesNotContain(search.Clients, c => c.Id == 200);

        AssertRefused(await svc.GetSettings(Guid.NewGuid(), Contact, 200), "Invalid client or contact.");
    }

    // ---------------- depots/postcodes clientId -----------------

    [Fact]
    public async Task Customer_cannot_learn_another_clients_scheduled_depots()
    {
        var opts = BulkImportTestHarness.NewOptions();
        var seed = BulkImportTestHarness.Context(opts);
        BulkClientScopeTests.SeedClients(seed);
        var depot = new TblBulkRegion { BulkRegionId = 1, Name = "CHC", Active = true };
        seed.TblBulkRegions.Add(depot);
        seed.BulkZonePostcodes.Add(new BulkZonePostcode { Id = 1, PostCode = 8011, Zone = 1, DepotId = 1, Depot = depot });
        // Client 200 has no schedule at depot 1: honouring its clientId would
        // flag the depot HasSchedules = false and so reveal that.
        await seed.SaveChangesAsync();

        var accessor = BulkImportTestHarness.Accessor("NZ", Customer);
        var here = new HereGeocodeService(new HttpClient(), new AppSettings());
        var svc = new AddressService(BulkImportTestHarness.Factory(opts), accessor, here, BulkImportTestHarness.Cache(accessor), new BulkClientScope(accessor));

        var resp = await svc.GetPostcodesByDepotAsync(Guid.NewGuid(), clientId: 200, contactId: Contact);
        Assert.True(Assert.Single(resp.Depots).HasSchedules);  // same as no clientId
    }
}
