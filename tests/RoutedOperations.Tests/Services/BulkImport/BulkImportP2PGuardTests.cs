// Acceptance test F guard for the truck bulk insert work (card
// bulk-insert-truck-and-ai, Part A). Steve's decision 6: a P2P file with no new
// columns must produce byte-identical proc calls to today. These were written
// and passed against untouched b8dd0c1 BEFORE any truck code was added, so a
// failure here means the truck work moved the P2P path, not that the test is
// out of date. Do not "fix" one by changing the expected values.
//
// Every INT_stpJob_BulkInsert argument is compared by parameter name, so adding,
// dropping or changing any one of them fails.
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using NSubstitute.Core;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.BulkImport;

public class BulkImportP2PGuardTests
{
    // ---------------- harness -----------------

    private sealed class RecordingContext(DbContextOptions options, IDespatchContextProcedures procs)
        : DynamicDespatchDbContext(options)
    {
        public override IDespatchContextProcedures Procedures { get => procs; set { } }
    }

    private sealed class NoHttpFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new BulkImportServiceV2CoreTests.FakeHandler());
    }

    private sealed record Rig(
        BulkImportServiceV2 Svc,
        DynamicDespatchDbContext Seed,
        IDespatchContextProcedures Procs);

    private static Rig NewRig(string clientTypeId = "4")
    {
        var options = BulkImportTestHarness.NewOptions();
        var procs = Substitute.For<IDespatchContextProcedures>();
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new RecordingContext(options, procs));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult<DynamicDespatchDbContext>(new RecordingContext(options, procs)));

        var accessor = BulkImportTestHarness.Accessor("NZ", clientTypeId, "UTC");
        var scope = new BulkClientScope(accessor);
        var here = new HereGeocodeService(
            new HttpClient(new BulkImportServiceV2CoreTests.FakeHandler()),
            new AppSettings { HereMapsApiKey = string.Empty });
        var address = new AddressService(factory, accessor, here, BulkImportTestHarness.Cache(accessor), scope);
        var svc = TruckTestFakes.NewService(factory, new NoHttpFactory(), accessor, address, scope);

        var seed = BulkImportTestHarness.Context(options);
        seed.TucClients.Add(new TucClient
        {
            UcclId = ClientId, UcclCode = "ACME", UcclName = "Acme", UcclActive = true, JobPrefix = "AC"
        });
        // Speed 3 is not a truck speed: TruckJobEntry stays at its default.
        seed.TucJobTypes.Add(new TucJobType { UcjtId = P2PSpeed, UcjtName = "Standard", SystemName = "ST", ZoneRated = false });
        seed.TucClientContacts.Add(new TucClientContact
        {
            UcctId = ContactId, UcctFirstname = "Pat", UcctSurname = "Test", UcctEmail = "pat@example.invalid", StaffId = 77
        });
        seed.SaveChanges();
        return new Rig(svc, seed, procs);
    }

    private const int ClientId = 5;
    private const int P2PSpeed = 3;
    private const int ContactId = 1;

    private static readonly DateTime BookDate = new(2031, 3, 4, 9, 30, 15);

    private static BulkImportJobCreateDto P2PRow(string number = "ACME1") => new()
    {
        JobNumber = number,
        FromContact = "Sender Name",
        FromCompany = "From Co",
        FromAddress = "1 From Street",
        FromSuburb = "Otahuhu",
        FromPostCode = "1062",
        ToCompany = "To Co",
        ToAddress = "2 To Street",
        ToSuburb = "Albany",
        ToPostCode = "0632",
        ToContact = "Receiver Name",
        ToContactPhone = "000 000",
        Quantity = 2,
        Length = 50m,
        Width = 40m,
        Height = 30m,
        Weight = 12.5m,
        ClientRefA = "RA",
        ClientRefB = "RB",
        OurRef = "OR",
        TrackingEmail = "track@example.invalid",
        TrackingMobile = "000 001",
    };

    private static BulkImportRequest OnDemand(params BulkImportJobCreateDto[] rows) => new()
    {
        ClientId = ClientId,
        SpeedId = P2PSpeed,
        BookDate = BookDate,
        JobType = "ondemand",
        Jobs = rows.ToList(),
    };

    private static List<Dictionary<string, object?>> CallsTo(IDespatchContextProcedures procs, string method) =>
        procs.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == method)
            .Select(ToArguments)
            .ToList();

    private static Dictionary<string, object?> ToArguments(ICall call)
    {
        var names = call.GetMethodInfo().GetParameters().Select(p => p.Name!).ToArray();
        var values = call.GetArguments();
        return names.Zip(values).ToDictionary(p => p.First, p => p.Second);
    }

    // Everything except the fields a given test deliberately overrides.
    private static Dictionary<string, object?> ExpectedOnDemandCall() => new()
    {
        ["jobNumber"] = "ACME1",
        ["bookDate"] = BookDate.Date,
        ["bookTime"] = new DateTime(1900, 1, 1, 9, 30, 15),
        ["clientID"] = ClientId,
        ["clientCode"] = "ACME",
        ["contact"] = "Sender Name",
        ["amount"] = 0m,
        ["speed"] = P2PSpeed,
        ["fromAddress"] = "1 From Street",
        ["fromSuburb"] = "Otahuhu",
        ["toAddress"] = "To Co, 2 To Street",
        ["toSuburb"] = "Albany",
        ["toContact"] = "Receiver Name",
        ["toContactPhone"] = "000 000",
        ["size"] = (short)2,
        ["qty"] = (short)2,
        ["weight"] = 12.5d,
        ["courierID"] = null,
        ["clientRefa"] = "RA",
        ["clientRefb"] = "RB",
        ["ourRef"] = "OR",
        ["deliverToPrivateBusiness"] = false,
        ["deliverToLeaveID"] = null,
        ["notes"] = "",
        ["remoteJob"] = false,
        ["trackingEmail"] = "track@example.invalid",
        ["trackingMobile"] = "000 001",
        ["proofOfDeliveryMobile"] = "000 000",
        ["proofOfDeliveryEmail"] = "track@example.invalid",
        ["pickUpLatitude"] = null,
        ["pickUpLongitude"] = null,
        ["deliveryLatitude"] = null,
        ["deliveryLongitude"] = null,
        ["prebookJob"] = false,
        ["onHold"] = false,
        ["wellingtonJob"] = false,
        ["nWDocJob"] = false,
        ["runName"] = null,
        ["fromGeoType"] = null,
        ["toGeoType"] = null,
        ["pODName"] = null,
        ["status"] = 0,
        ["complTime"] = null,
        ["jobDone"] = false,
        ["sourceID"] = 3,
        ["fromCompany"] = "From Co",
        ["fromExtra"] = "",
        ["fromStreet"] = "1 From Street",
        ["fromPostCode"] = 1062,
        ["toCompany"] = "To Co",
        ["toExtra"] = "",
        ["toStreet"] = "2 To Street",
        ["toPostCode"] = 632,
        ["pickupTimeZone"] = "",
        ["deliverByTimeZone"] = "",
        ["opID"] = 77,
        ["returnValue"] = null,
        ["cancellationToken"] = default(CancellationToken),
    };

    private static void AssertSameArguments(Dictionary<string, object?> expected, Dictionary<string, object?> actual)
    {
        Assert.Equal(expected.Keys.OrderBy(k => k), actual.Keys.OrderBy(k => k));
        foreach (var (name, value) in expected)
            Assert.True(Equals(value, actual[name]), $"{name}: expected <{value ?? "null"}> but was <{actual[name] ?? "null"}>");
    }

    // ---------------- wizard on-demand path -----------------

    [Fact]
    public async Task P2P_row_calls_the_bulk_proc_with_exactly_todays_arguments()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PRow()));

        Assert.True(resp.Success);
        var call = Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"));
        AssertSameArguments(ExpectedOnDemandCall(), call);
    }

    [Fact]
    public async Task P2P_row_with_a_delivery_phone_gets_no_text_tracking_and_no_pallet_note()
    {
        // Steve 4 Nov: text tracking is for bulk truck jobs only, and the pallet note
        // is a truck rule. The phone stays where it went before, in the proof of
        // delivery field, and the tracking mobile stays empty.
        var rig = NewRig();
        var row = P2PRow();
        row.TrackingEmail = null;
        row.TrackingMobile = null;

        await rig.Svc.Import(ContactId, OnDemand(row));

        var expected = ExpectedOnDemandCall();
        expected["trackingEmail"] = "";
        expected["trackingMobile"] = "";
        expected["proofOfDeliveryEmail"] = "";
        AssertSameArguments(expected, Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync")));
    }

    [Fact]
    public async Task P2P_row_writes_one_item_per_quantity_through_the_bulk_item_proc()
    {
        // This is the existing P2P item behaviour, including that the proc writes
        // nothing for an on-demand job. Fixing that is a separate card (decision 6).
        var rig = NewRig();
        rig.Seed.TucJobs.Add(new TucJob { UcjbId = 900, UcjbNumber = "ACME1" });
        rig.Seed.SaveChanges();

        await rig.Svc.Import(ContactId, OnDemand(P2PRow()));

        var items = CallsTo(rig.Procs, "NET_stpBulkJobItems_InsertAsync");
        Assert.Equal(2, items.Count);
        Assert.Equal(900, items[0]["jobID"]);
        Assert.Equal(0, items[0]["itemID"]);
        Assert.Equal(1, items[0]["items"]);
        Assert.Equal(12.5d, items[0]["weight"]);
        Assert.Equal(50d, items[0]["length"]);
        Assert.Equal(30d, items[0]["height"]);
        Assert.Equal(40d, items[0]["depth"]);
        Assert.Equal("ACME1-1", items[0]["barcode"]);
        Assert.Equal("ACME1-2", items[1]["barcode"]);
    }

    [Theory]
    [InlineData(120, 90, 90, 400, 2)]
    [InlineData(121, 90, 90, 400, 3)]
    [InlineData(120, 91, 90, 400, 3)]
    [InlineData(120, 90, 91, 400, 3)]
    [InlineData(120, 90, 90, 401, 3)]
    public async Task P2P_vehicle_size_still_comes_from_the_row_dimensions(
        int length, int width, int height, int weight, int expectedSize)
    {
        var rig = NewRig();
        var row = P2PRow();
        row.Length = length;
        row.Width = width;
        row.Height = height;
        row.Weight = weight;

        await rig.Svc.Import(ContactId, OnDemand(row));

        var call = Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"));
        Assert.Equal((short)expectedSize, call["size"]);
    }

    [Fact]
    public async Task P2P_import_as_completed_keeps_its_proc_arguments()
    {
        var rig = NewRig();
        var req = OnDemand(P2PRow());
        req.ImportAsCompleted = true;

        await rig.Svc.Import(ContactId, req);

        var call = Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"));
        Assert.Equal(6, call["status"]);
        Assert.Equal(true, call["jobDone"]);
        Assert.Null(call["trackingEmail"]);
        Assert.Null(call["trackingMobile"]);
        Assert.Null(call["proofOfDeliveryMobile"]);
        Assert.Null(call["proofOfDeliveryEmail"]);
        Assert.Equal("Pat Test (pat@example.invalid)", call["pODName"]);
    }

    [Fact]
    public async Task P2P_staff_amount_still_reaches_the_proc_and_customer_amount_does_not()
    {
        var staff = NewRig("4");
        var staffRow = P2PRow();
        staffRow.Amount = 42.5m;
        await staff.Svc.Import(ContactId, OnDemand(staffRow));
        Assert.Equal(42.5m, Assert.Single(CallsTo(staff.Procs, "INT_stpJob_BulkInsertAsync"))["amount"]);

        var customer = NewRig("2");
        customer.Seed.TucClientContacts.Find(ContactId)!.UcctClientId = ClientId;
        customer.Seed.TucClientContacts.Find(ContactId)!.Active = true;
        customer.Seed.SaveChanges();
        var customerRow = P2PRow();
        customerRow.Amount = 42.5m;
        await customer.Svc.Import(ContactId, OnDemand(customerRow));
        Assert.Equal(0m, Assert.Single(CallsTo(customer.Procs, "INT_stpJob_BulkInsertAsync"))["amount"]);
    }

    // ---------------- staff import path -----------------

    private static Dictionary<string, object> StaffRow() => new()
    {
        ["ClientID"] = ClientId,
        ["JobNumber"] = "STAFF1",
        ["BookDate"] = "2031-03-04",
        ["Contact"] = "Sender Name",
        ["Amount"] = "10.50",
        ["Speed"] = P2PSpeed,
        ["FromAddress"] = "1 From Street",
        ["FromSuburb"] = "Otahuhu",
        ["ToCompany"] = "To Co",
        ["ToAddress"] = "2 To Street",
        ["ToSuburb"] = "Albany",
        ["ToContact"] = "Receiver Name",
        ["ToContactPhone"] = "000 000",
        ["Qty"] = 2,
        ["Weight"] = "12.5",
    };

    [Fact]
    public async Task P2P_staff_import_row_keeps_its_proc_arguments()
    {
        var rig = NewRig();

        var resp = await rig.Svc.StaffImport(ContactId, new StaffImportRequest { Jobs = new[] { StaffRow() } });

        Assert.Equal(1, resp.SuccessCount);
        var call = Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"));
        Assert.Equal("STAFF1", call["jobNumber"]);
        Assert.Equal(10.5m, call["amount"]);
        Assert.Equal(P2PSpeed, call["speed"]);
        Assert.Equal((short)2, call["size"]);
        Assert.Equal((short)2, call["qty"]);
        Assert.Equal(12.5d, call["weight"]);
        Assert.Equal("To Co, 2 To Street", call["toAddress"]);
        Assert.Null(call["bookTime"]);
        Assert.Equal(1, call["status"]);
        Assert.Equal(3, call["sourceID"]);
        Assert.Equal(77, call["opID"]);
    }

    [Fact]
    public async Task P2P_staff_import_without_a_speed_still_defaults_to_speed_1()
    {
        var rig = NewRig();
        var row = StaffRow();
        row.Remove("Speed");

        await rig.Svc.StaffImport(ContactId, new StaffImportRequest { Jobs = new[] { row } });

        Assert.Equal(1, Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"))["speed"]);
    }
}
