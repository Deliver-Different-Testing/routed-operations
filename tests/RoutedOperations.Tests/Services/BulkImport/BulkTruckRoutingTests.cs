// Which rows reach the truck path, and what happens to the ones that must not.
// The original fault (ticket 881) was a truck speed priced as a van: routing is the
// fix, so these fail if a truck row can reach INT_stpJob_BulkInsert, or a P2P row
// can miss it. The preflight and inserter are fakes; no SQL runs.
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using NSubstitute.Core;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.BulkImport;

public class BulkTruckRoutingTests
{
    private const int ClientId = 5;
    private const int ContactId = 1;
    private const int P2PSpeed = 3;
    private const int Teco = 52;
    private const int TruckStandard = 43;
    private const int ChilledTruck = 124;
    private const int NotOnClientList = 41;

    private sealed class RecordingContext(DbContextOptions options, IDespatchContextProcedures procs)
        : DynamicDespatchDbContext(options)
    {
        public override IDespatchContextProcedures Procedures { get => procs; set { } }
    }

    private sealed class NoHttpFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new BulkImportServiceV2CoreTests.FakeHandler());
    }

    private sealed class Rig
    {
        public required BulkImportServiceV2 Svc { get; init; }
        public required DynamicDespatchDbContext Seed { get; init; }
        public required IDespatchContextProcedures Procs { get; init; }
        public required IBulkTruckPreflight Preflight { get; init; }
        public required IBulkTruckInserter Inserter { get; init; }
        public List<TruckInsertRow> Inserted { get; } = new();
        public Func<TruckRowPlan, TruckPreflightRow> Rate { get; set; } = plan => Priced(plan, 50m);

        public int P2PCalls => CallsTo("INT_stpJob_BulkInsertAsync").Count;

        public List<Dictionary<string, object?>> CallsTo(string method) =>
            Procs.ReceivedCalls().Where(c => c.GetMethodInfo().Name == method).Select(ToArguments).ToList();
    }

    private static Dictionary<string, object?> ToArguments(ICall call)
    {
        var names = call.GetMethodInfo().GetParameters().Select(p => p.Name!).ToArray();
        return names.Zip(call.GetArguments()).ToDictionary(p => p.First, p => p.Second);
    }

    private static TruckPreflightRow Priced(TruckRowPlan plan, decimal rate) => new()
    {
        RowNo = plan.Input.RowNo,
        FromSuburbId = 10,
        ToSuburbId = 11,
        IsLocal = true,
        EffectiveSpeedId = plan.Input.SpeedId,
        Rate = rate,
        Fuel = 1m,
        ServerNow = new DateTime(2031, 1, 1),
    };

    private static Rig NewRig(string clientTypeId = "4", string tenant = "NZ")
    {
        var options = BulkImportTestHarness.NewOptions();
        var procs = Substitute.For<IDespatchContextProcedures>();
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new RecordingContext(options, procs));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult<DynamicDespatchDbContext>(new RecordingContext(options, procs)));

        var accessor = BulkImportTestHarness.Accessor(tenant, clientTypeId, "UTC");
        var scope = new BulkClientScope(accessor);
        var here = new HereGeocodeService(new HttpClient(new BulkImportServiceV2CoreTests.FakeHandler()), new AppSettings { HereMapsApiKey = string.Empty });
        var address = new AddressService(factory, accessor, here, BulkImportTestHarness.Cache(accessor), scope);
        var preflight = Substitute.For<IBulkTruckPreflight>();
        var inserter = Substitute.For<IBulkTruckInserter>();

        var seed = BulkImportTestHarness.Context(options);
        seed.TucClients.Add(new TucClient { UcclId = ClientId, UcclCode = "ACME", UcclName = "Acme", UcclActive = true, JobPrefix = "AC" });
        seed.TucJobTypes.AddRange(
            new TucJobType { UcjtId = P2PSpeed, UcjtName = "Standard", ShortName = "STD", SystemName = "ST", ZoneRated = false },
            new TucJobType { UcjtId = Teco, UcjtName = "Truck Economy", ShortName = "TECO", SystemName = "TY", ZoneRated = false, TruckJobEntry = true },
            new TucJobType { UcjtId = TruckStandard, UcjtName = "Truck Standard", ShortName = "TSTD", SystemName = "TS", ZoneRated = false, TruckJobEntry = true },
            new TucJobType { UcjtId = ChilledTruck, UcjtName = "Chilled Truck", ShortName = "CT", SystemName = "CT", ZoneRated = false, TruckJobEntry = true },
            new TucJobType { UcjtId = NotOnClientList, UcjtName = "Truck Super", ShortName = "TSPR", SystemName = "TSP", ZoneRated = false, TruckJobEntry = true });
        var id = 1;
        foreach (var speed in new[] { P2PSpeed, Teco, TruckStandard, ChilledTruck })
            seed.TblClientAvailableSpeeds.Add(new TblClientAvailableSpeed { Id = id++, ClientId = ClientId, SpeedId = speed, Active = true, WebVisible = true });
        seed.TucClientContacts.Add(new TucClientContact
        {
            UcctId = ContactId, UcctFirstname = "Pat", UcctSurname = "Test", UcctEmail = "pat@example.invalid", StaffId = 77,
            UcctClientId = ClientId, Active = true,
        });
        seed.SaveChanges();

        var rig = new Rig
        {
            Svc = TruckTestFakes.NewService(factory, new NoHttpFactory(), accessor, address, scope, preflight, inserter),
            Seed = seed,
            Procs = procs,
            Preflight = preflight,
            Inserter = inserter,
        };
        preflight.LoadClientsAsync(Arg.Any<IReadOnlyCollection<int>>())
            .Returns(call => Task.FromResult<IReadOnlyDictionary<int, TruckClientFacts>>(
                call.Arg<IReadOnlyCollection<int>>().ToDictionary(c => c, c => new TruckClientFacts(c, "ACME", null, false, false, null, false, null))));
        preflight.RunAsync(Arg.Any<IReadOnlyList<TruckRowPlan>>())
            .Returns(call => Task.FromResult<IReadOnlyList<TruckPreflightRow>>(call.Arg<IReadOnlyList<TruckRowPlan>>().Select(p => rig.Rate(p)).ToList()));
        inserter.InsertAsync(Arg.Any<IReadOnlyList<TruckInsertRow>>(), Arg.Any<DateTime>())
            .Returns(call =>
            {
                var rows = call.Arg<IReadOnlyList<TruckInsertRow>>();
                rig.Inserted.AddRange(rows);
                return Task.FromResult<IReadOnlyList<TruckInsertOutcome>>(rows.Select(r => new TruckInsertOutcome(r.RowNo, 1000 + r.RowNo, null, null)).ToList());
            });
        return rig;
    }

    private static BulkImportJobCreateDto Row(string number, string? speed = null) => new()
    {
        JobNumber = number,
        Speed = speed,
        FromContact = "Sender Name",
        FromCompany = "From Co",
        FromAddress = "1 From Street",
        FromSuburb = "Otahuhu",
        FromPostCode = "1062",
        ToCompany = "To Co",
        ToAddress = "2 To Street",
        ToSuburb = "Otahuhu",
        ToPostCode = "1062",
        ToContact = "Receiver Name",
        ToContactPhone = "000 000",
        Quantity = 1,
        Length = 120,
        Width = 100,
        Height = 90,
        Weight = 250,
    };

    private static BulkImportRequest OnDemand(int batchSpeed, params BulkImportJobCreateDto[] rows) => new()
    {
        ClientId = ClientId,
        SpeedId = batchSpeed,
        BookDate = new DateTime(2031, 3, 4, 9, 30, 0),
        JobType = "ondemand",
        Jobs = rows.ToList(),
    };

    [Fact]
    public async Task A_truck_speed_in_the_speed_column_goes_to_the_inserter_and_never_the_van_proc()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("T1", "TECO")));

        Assert.True(resp.Success);
        Assert.Equal(0, rig.P2PCalls);
        var row = Assert.Single(rig.Inserted);
        Assert.Equal(Teco, row.ucjbSpeed);
        Assert.Equal(4, row.ucjbSize);
    }

    [Fact]
    public async Task A_truck_batch_speed_with_no_speed_column_routes_every_row()
    {
        var rig = NewRig();
        await rig.Svc.Import(ContactId, OnDemand(Teco, Row("T1"), Row("T2")));
        Assert.Equal(0, rig.P2PCalls);
        Assert.Equal(2, rig.Inserted.Count);
    }

    [Fact]
    public async Task A_mixed_file_splits_and_the_p2p_row_is_priced_at_its_own_speed()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(Teco, Row("T1", "TECO"), Row("P1", "Standard"), Row("T2", "Truck Standard")));

        Assert.True(resp.Success);
        Assert.Equal(2, rig.Inserted.Count);
        var p2p = Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"));
        Assert.Equal("P1", p2p["jobNumber"]);
        Assert.Equal(P2PSpeed, p2p["speed"]);
    }

    [Fact]
    public async Task A_speed_the_client_does_not_have_is_rejected_by_the_server()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("T1", "TSPR"), Row("P1")));

        var rejected = Assert.Single(resp.Jobs);
        Assert.Equal("Speed TSPR is not available for this client.", rejected.ErrorMessage);
        Assert.True(rejected.TruckRejected);
        Assert.Empty(rig.Inserted);
        Assert.Equal(1, rig.P2PCalls);
    }

    [Fact]
    public async Task A_truck_speed_outside_the_v1_list_is_refused_rather_than_priced_as_a_van()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("C1", "CT")));

        Assert.False(resp.Success);
        var rejected = Assert.Single(resp.Jobs);
        Assert.Contains("Chilled Truck cannot be bulk imported", rejected.ErrorMessage);
        Assert.Equal(0, rig.P2PCalls);
        Assert.Empty(rig.Inserted);
    }

    [Fact]
    public async Task A_row_rated_at_zero_is_rejected_and_reaches_no_insert()
    {
        var rig = NewRig();
        rig.Rate = plan => Priced(plan, 0m);

        var resp = await rig.Svc.Import(ContactId, OnDemand(Teco, Row("T1")));

        Assert.False(resp.Success);
        var rejected = Assert.Single(resp.Jobs);
        Assert.Contains("No truck rate", rejected.ErrorMessage);
        Assert.True(rejected.TruckRejected);
        Assert.Empty(rig.Inserted);
    }

    [Fact]
    public async Task Staff_amount_survives_a_zero_rate_and_is_rated_manually()
    {
        var rig = NewRig("4");
        rig.Rate = plan => Priced(plan, 0m);
        var row = Row("T1");
        row.Amount = 88m;

        await rig.Svc.Import(ContactId, OnDemand(Teco, row));

        var inserted = Assert.Single(rig.Inserted);
        Assert.Equal(88m, inserted.ucjbAmount);
        Assert.True(inserted.RatedManually);
    }

    [Fact]
    public async Task A_customer_amount_is_stripped_so_the_row_is_rated()
    {
        var rig = NewRig("2");
        var row = Row("T1");
        row.Amount = 1m;

        await rig.Svc.Import(ContactId, OnDemand(Teco, row));

        var inserted = Assert.Single(rig.Inserted);
        Assert.Equal(51m, inserted.ucjbAmount);
        Assert.False(inserted.RatedManually);
    }

    [Fact]
    public async Task A_duplicate_number_in_the_file_fails_only_the_repeat()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(Teco, Row("T1"), Row("T1"), Row("T2")));

        Assert.True(resp.Success);
        Assert.Equal(2, rig.Inserted.Count);
        Assert.Contains("appears more than once", Assert.Single(resp.Jobs).ErrorMessage);
    }

    [Fact]
    public async Task Batch_defaults_fill_only_what_the_row_left_empty()
    {
        var rig = NewRig();
        rig.Seed.TblGssstockSizes.Add(new TblGssstockSize { Id = 1, Name = "Half Pallet", Length = 120, Width = 100, Height = 90, Weight = 250 });
        rig.Seed.SaveChanges();
        var usesDefaults = Row("T1");
        usesDefaults.Length = usesDefaults.Width = usesDefaults.Height = usesDefaults.Weight = 0;
        var overrides = Row("T2");
        overrides.TailLiftDropoff = false;
        var req = OnDemand(Teco, usesDefaults, overrides);
        req.TruckDefaults = new BulkTruckDefaults { PalletType = "Half Pallet", TailLiftDropoff = true };

        await rig.Svc.Import(ContactId, req);

        var first = rig.Inserted.Single(r => r.ucjbNumber == "T1");
        Assert.Equal(250, first.ucjbWeight);
        Assert.True(first.Items[0].DO);
        Assert.Equal("Half Pallet", first.Items[0].Notes);
        Assert.Equal(100d, first.Items[0].Depth);
        Assert.False(rig.Inserted.Single(r => r.ucjbNumber == "T2").Items[0].DO);
    }

    [Fact]
    public async Task A_pallet_type_that_is_not_a_stock_size_is_kept_as_the_item_name()
    {
        // No new rule: an unknown name is not a rejection. Open for Steve.
        var rig = NewRig();
        var row = Row("T1");
        row.PalletType = "Custom Crate";

        var resp = await rig.Svc.Import(ContactId, OnDemand(Teco, row));

        Assert.True(resp.Success);
        Assert.Equal("Custom Crate", Assert.Single(rig.Inserted).Items[0].Notes);
    }

    [Fact]
    public async Task Truck_sized_values_pass_but_a_p2p_row_in_the_same_file_keeps_its_caps()
    {
        var rig = NewRig();
        var truck = Row("T1", "TECO");
        truck.Height = 180;
        var p2p = Row("P1", "Standard");
        p2p.Height = 180;
        var req = OnDemand(Teco, truck, p2p);
        req.TruckDefaults = new BulkTruckDefaults();

        var resp = await rig.Svc.Import(ContactId, req);

        Assert.Single(rig.Inserted);
        Assert.Equal(0, rig.P2PCalls);
        Assert.Contains("Height must be 150", Assert.Single(resp.Jobs).ErrorMessage);
    }

    [Fact]
    public async Task A_p2p_file_never_touches_the_truck_path()
    {
        var rig = NewRig();
        await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("P1")));
        Assert.Equal(1, rig.P2PCalls);
        await rig.Preflight.DidNotReceiveWithAnyArgs().RunAsync(default!);
        await rig.Inserter.DidNotReceiveWithAnyArgs().InsertAsync(default!, default);
    }

    [Fact]
    public async Task A_us_tenant_ignores_the_truck_path()
    {
        var rig = NewRig(tenant: "US");
        await rig.Svc.Import(ContactId, OnDemand(Teco, Row("T1", "TECO")));
        await rig.Preflight.DidNotReceiveWithAnyArgs().RunAsync(default!);
        await rig.Inserter.DidNotReceiveWithAnyArgs().InsertAsync(default!, default);
    }

    [Fact]
    public async Task A_routed_import_ignores_the_truck_path()
    {
        var rig = NewRig();
        var req = OnDemand(Teco, Row("T1", "TECO"));
        req.JobType = "routed";
        req.TruckDefaults = new BulkTruckDefaults();
        await rig.Svc.Import(ContactId, req);
        await rig.Preflight.DidNotReceiveWithAnyArgs().RunAsync(default!);
        await rig.Inserter.DidNotReceiveWithAnyArgs().InsertAsync(default!, default);
    }

    // ---- staff import --------------------------------------------------------

    private static Dictionary<string, object> StaffRow(string number, object speed, string? amount = null)
    {
        var row = new Dictionary<string, object>
        {
            ["ClientID"] = ClientId,
            ["JobNumber"] = number,
            ["BookDate"] = "2031-03-04",
            ["Contact"] = "Sender Name",
            ["Speed"] = speed,
            ["FromAddress"] = "1 From Street",
            ["FromSuburb"] = "Otahuhu",
            ["ToCompany"] = "To Co",
            ["ToAddress"] = "2 To Street",
            ["ToSuburb"] = "Otahuhu",
            ["ToContact"] = "Receiver Name",
            ["ToContactPhone"] = "000 000",
            ["Qty"] = 2,
            ["Weight"] = "250",
            ["Length"] = "120",
            ["Width"] = "100",
            ["Height"] = "90",
            ["Tail Lift DO"] = "Y",
        };
        if (amount != null) row["Amount"] = amount;
        return row;
    }

    [Fact]
    public async Task Staff_import_sends_truck_rows_to_the_inserter_and_keeps_p2p_in_its_loop()
    {
        var rig = NewRig();

        var resp = await rig.Svc.StaffImport(ContactId, new StaffImportRequest
        {
            Jobs = new[] { StaffRow("T1", "TECO", "99.50"), StaffRow("P1", P2PSpeed), StaffRow("T2", Teco) },
        });

        Assert.Equal(3, resp.SuccessCount);
        Assert.Equal("P1", Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["jobNumber"]);
        var manual = rig.Inserted.Single(r => r.ucjbNumber == "T1");
        Assert.Equal(99.5m, manual.ucjbAmount);
        Assert.True(manual.RatedManually);
        var rated = rig.Inserted.Single(r => r.ucjbNumber == "T2");
        Assert.False(rated.RatedManually);
        Assert.Equal(500, rated.ucjbWeight);
        Assert.All(rated.Items, i => Assert.True(i.DO));
    }

    [Fact]
    public async Task Staff_import_reports_a_rejected_truck_row_against_its_file_row()
    {
        var rig = NewRig();
        rig.Rate = plan => plan.Input.Job.JobNumber == "T2" ? Priced(plan, 0m) : Priced(plan, 50m);

        var resp = await rig.Svc.StaffImport(ContactId, new StaffImportRequest
        {
            Jobs = new[] { StaffRow("T1", Teco), StaffRow("T2", Teco) },
        });

        Assert.Equal(1, resp.SuccessCount);
        var failed = Assert.Single(resp.FailedJobs);
        Assert.Equal(2, failed.RowNumber);
        Assert.Contains("No truck rate", failed.Error);
    }

    // ---- synthetic customer files -------------------------------------------

    private static string Fixture(string name)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "tests", "e2e", "fixtures", "bulk-truck")))
            dir = dir.Parent;
        return Path.Combine(dir!.FullName, "tests", "e2e", "fixtures", "bulk-truck", name);
    }

    private static async Task<List<Dictionary<string, JsonElement>>> Upload(Rig rig, string name)
    {
        var bytes = await File.ReadAllBytesAsync(Fixture(name));
        var file = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", name) { Headers = new HeaderDictionary() };
        var json = await rig.Svc.UploadFile(ContactId, file);
        return JsonSerializer.Deserialize<List<Dictionary<string, JsonElement>>>(json)!;
    }

    private static string Text(Dictionary<string, JsonElement> row, string key) =>
        row.TryGetValue(key, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString()) : "";

    [Theory]
    [InlineData("bulk-truck-ingram-like.csv")]
    [InlineData("bulk-truck-ingram-like.xlsx")]
    public async Task The_mixed_fixture_parses_through_the_upload(string name)
    {
        var rows = await Upload(NewRig(), name);
        Assert.Equal(8, rows.Count);
        Assert.Equal("TECO", Text(rows[0], "Speed"));
        Assert.Equal("Half Pallet", Text(rows[0], "Pallet Type"));
        Assert.Equal("Y", Text(rows[3], "Tail Lift DO"));
        Assert.Equal("3", Text(rows[4], "DG Class"));
    }

    [Theory]
    [InlineData("bulk-truck-total-weight.csv")]
    [InlineData("bulk-truck-total-weight.xlsx")]
    public async Task The_total_weight_fixture_parses_through_the_upload(string name)
    {
        var rows = await Upload(NewRig(), name);
        Assert.Equal(2, rows.Count);
        Assert.Equal(500m, decimal.Parse(Text(rows[0], "Total Weight")));
        Assert.False(rows[0].ContainsKey("Weight"));
    }

    [Fact]
    public async Task The_mixed_fixture_has_the_expected_outcome_on_every_row()
    {
        var rig = NewRig();
        var parsed = await Upload(rig, "bulk-truck-ingram-like.csv");
        var jobs = parsed.Select(r => new BulkImportJobCreateDto
        {
            JobNumber = Text(r, "Job Number"),
            Speed = Text(r, "Speed"),
            FromContact = Text(r, "From Contact"),
            FromCompany = Text(r, "From Company"),
            FromAddress = Text(r, "Pickup Address"),
            FromSuburb = Text(r, "Pickup Suburb"),
            FromPostCode = Text(r, "Pickup Post Code"),
            ToCompany = Text(r, "Recipient Company"),
            ToAddress = Text(r, "Delivery Address"),
            ToSuburb = Text(r, "To Suburb"),
            ToPostCode = Text(r, "To Post Code"),
            ToContact = Text(r, "Delivery Contact"),
            ToContactPhone = Text(r, "Delivery Phone"),
            Quantity = short.Parse(Text(r, "Pallets")),
            PalletType = Text(r, "Pallet Type"),
            Length = decimal.Parse(Text(r, "Length")),
            Width = decimal.Parse(Text(r, "Width")),
            Height = decimal.Parse(Text(r, "Height")),
            Weight = decimal.Parse(Text(r, "Weight")),
            TailLiftDropoff = Text(r, "Tail Lift DO") == "Y",
            Residential = Text(r, "Residential") == "Y",
            DgClass = int.TryParse(Text(r, "DG Class"), out var dg) ? dg : null,
            Notes = Text(r, "Notes"),
        }).ToArray();
        // Row BT1006 delivers to Christchurch from an Auckland pickup.
        rig.Rate = plan =>
        {
            var pre = Priced(plan, 50m);
            pre.IsLocal = plan.Input.Job.ToPostCode != "8042";
            return pre;
        };

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, jobs));

        Assert.Equal(new[] { "BT1001", "BT1002", "BT1004", "BT1005" }, rig.Inserted.Select(r => r.ucjbNumber).OrderBy(n => n));
        Assert.Equal("BT1003", Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["jobNumber"]);

        var reasons = resp.Jobs.Select(j => j.ErrorMessage).ToList();
        Assert.Equal(3, reasons.Count);
        Assert.Contains(reasons, r => r!.Contains("different regions"));
        Assert.Contains(reasons, r => r!.Contains("Chilled Truck cannot be bulk imported"));
        Assert.Contains(reasons, r => r!.Contains("appears more than once"));
        Assert.All(resp.Jobs, j => Assert.True(j.TruckRejected));

        var tailLift = rig.Inserted.Single(r => r.ucjbNumber == "BT1004");
        Assert.True(tailLift.Items[0].DO);
        var dangerous = rig.Inserted.Single(r => r.ucjbNumber == "BT1005");
        Assert.Equal(1, dangerous.DGClass);
        Assert.Equal(3, dangerous.Items[0].DGClass);
        Assert.StartsWith("DG Class: 3", dangerous.ucjbNotes);
    }
}
