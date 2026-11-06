// The preview is only worth having if the price on screen is the price that lands
// and looking at it changes nothing. So these compare a preview with a real Import
// of the same rows, and fail if a preview reaches the inserter or assigns a number.
// The preflight and inserter are fakes; no SQL runs.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.BulkImport;

public class BulkTruckPreviewTests
{
    private const int ClientId = 5;
    private const int OtherClientId = 6;
    private const int ContactId = 1;
    private const int P2PSpeed = 3;
    private const int Teco = 52;
    private const int ChilledTruck = 124;

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
        public required List<TruckInsertRow> Inserted { get; init; }
        public Func<TruckRowPlan, TruckPreflightRow> Rate { get; set; } = plan => Priced(plan, 50m, 2.5m);
        public bool Baggage { get; set; }
    }

    private static TruckPreflightRow Priced(TruckRowPlan plan, decimal rate, decimal fuel) => new()
    {
        RowNo = plan.Input.RowNo,
        FromSuburbId = 10,
        ToSuburbId = 11,
        FromSuburbName = "Otahuhu",
        ToSuburbName = "Onehunga",
        IsLocal = true,
        EffectiveSpeedId = plan.Input.SpeedId,
        Rate = rate,
        Fuel = fuel,
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
        var inserted = new List<TruckInsertRow>();

        var seed = BulkImportTestHarness.Context(options);
        seed.TucClients.AddRange(
            new TucClient { UcclId = ClientId, UcclCode = "ACME", UcclName = "Acme", UcclActive = true, JobPrefix = "AC" },
            new TucClient { UcclId = OtherClientId, UcclCode = "OTHER", UcclName = "Other", UcclActive = true, JobPrefix = "OT" });
        seed.TucJobTypes.AddRange(
            new TucJobType { UcjtId = P2PSpeed, UcjtName = "Standard", ShortName = "STD", SystemName = "ST", ZoneRated = false },
            new TucJobType { UcjtId = Teco, UcjtName = "Truck Economy", ShortName = "TECO", SystemName = "TY", ZoneRated = false, TruckJobEntry = true },
            new TucJobType { UcjtId = ChilledTruck, UcjtName = "Chilled Truck", ShortName = "CT", SystemName = "CT", ZoneRated = false, TruckJobEntry = true });
        var id = 1;
        foreach (var client in new[] { ClientId, OtherClientId })
            foreach (var speed in new[] { P2PSpeed, Teco, ChilledTruck })
                seed.TblClientAvailableSpeeds.Add(new TblClientAvailableSpeed { Id = id++, ClientId = client, SpeedId = speed, Active = true, WebVisible = true });
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
            Inserted = inserted,
        };
        preflight.LoadClientsAsync(Arg.Any<IReadOnlyCollection<int>>())
            .Returns(call => Task.FromResult<IReadOnlyDictionary<int, TruckClientFacts>>(
                call.Arg<IReadOnlyCollection<int>>().ToDictionary(c => c, c => new TruckClientFacts(c, "ACME", null, rig.Baggage, false, null, false, null))));
        preflight.RunAsync(Arg.Any<IReadOnlyList<TruckRowPlan>>())
            .Returns(call => Task.FromResult<IReadOnlyList<TruckPreflightRow>>(call.Arg<IReadOnlyList<TruckRowPlan>>().Select(p => rig.Rate(p)).ToList()));
        inserter.InsertAsync(Arg.Any<IReadOnlyList<TruckInsertRow>>(), Arg.Any<DateTime>())
            .Returns(call =>
            {
                var rows = call.Arg<IReadOnlyList<TruckInsertRow>>();
                inserted.AddRange(rows);
                return Task.FromResult<IReadOnlyList<TruckInsertOutcome>>(rows.Select(r => new TruckInsertOutcome(r.RowNo, 1000 + r.RowNo, null, null)).ToList());
            });
        return rig;
    }

    private static BulkImportJobCreateDto Row(string number, string? speed = null, short qty = 1) => new()
    {
        JobNumber = number,
        Speed = speed,
        FromContact = "Sender Name",
        FromCompany = "From Co",
        FromAddress = "1 From Street",
        FromSuburb = "Otahuhu",
        FromPostCode = "1062",
        FromLatitude = "-36.9",
        FromLongitude = "174.8",
        ToCompany = "To Co",
        ToAddress = "2 To Street",
        ToSuburb = "Onehunga",
        ToPostCode = "1061",
        ToContact = "Receiver Name",
        ToContactPhone = "000 000",
        Quantity = qty,
        Length = 120,
        Width = 100,
        Height = 90,
        Weight = 250,
    };

    private static BulkImportRequest OnDemand(int batchSpeed, int clientId, params BulkImportJobCreateDto[] rows) => new()
    {
        ClientId = clientId,
        SpeedId = batchSpeed,
        BookDate = new DateTime(2031, 3, 4, 9, 30, 0),
        JobType = "ondemand",
        Jobs = rows.ToList(),
    };

    private static BulkImportRequest OnDemand(int batchSpeed, params BulkImportJobCreateDto[] rows) =>
        OnDemand(batchSpeed, ClientId, rows);

    private static void NothingWasWritten(Rig rig)
    {
        Assert.Empty(rig.Inserted);
        Assert.Empty(rig.Procs.ReceivedCalls());
    }

    [Fact]
    public async Task The_previewed_price_is_the_amount_the_insert_writes()
    {
        var rig = NewRig();
        rig.Rate = plan => plan.Input.Job.JobNumber == "T2" ? Priced(plan, 41.4287m, 3.0657m) : Priced(plan, 50m, 2.5m);
        BulkImportRequest Request() => OnDemand(P2PSpeed, Row("T1", "TECO", qty: 3), Row("T2", "Truck Economy"));

        var preview = await rig.Svc.PreviewTruckRows(ContactId, Request());
        NothingWasWritten(rig);
        await rig.Svc.Import(ContactId, Request());

        Assert.True(preview.Success);
        Assert.Equal(2, preview.Rows.Count);
        foreach (var row in preview.Rows)
        {
            var inserted = rig.Inserted.Single(i => i.ucjbNumber == row.JobNumber);
            Assert.Equal(inserted.ucjbAmount, row.Amount);
            Assert.Equal(inserted.RatedManually, row.RatedManually);
            Assert.Equal(inserted.ucjbQty, row.Quantity);
        }
        var second = preview.Rows.Single(r => r.JobNumber == "T2");
        Assert.Equal(41.4287m, second.Rate);
        Assert.Equal(3.0657m, second.Fuel);
        Assert.Equal(44.4944m, second.Amount);
    }

    [Fact]
    public async Task The_preview_gives_the_preflight_what_the_insert_gives_it()
    {
        // The price comes from the preflight, so the same inputs mean the same price.
        var rig = NewRig();
        var sent = new List<string>();
        rig.Preflight.RunAsync(Arg.Do<IReadOnlyList<TruckRowPlan>>(p => sent.Add(BulkTruckPreflight.BuildRowsJson(p))));
        BulkImportRequest Request()
        {
            var req = OnDemand(Teco, Row("T1", qty: 2), Row("T2"));
            req.TruckDefaults = new BulkTruckDefaults { TailLiftDropoff = true, Residential = true };
            return req;
        }

        await rig.Svc.PreviewTruckRows(ContactId, Request());
        await rig.Svc.Import(ContactId, Request());

        Assert.Equal(2, sent.Count);
        Assert.Equal(sent[0], sent[1]);
    }

    [Fact]
    public async Task Rows_sharing_a_pickup_all_get_what_the_geocode_found()
    {
        // The postcode decides the pickup site, and so the rate, so a second row
        // with the same pickup must not be left on the typed postcode.
        var rig = NewRig();
        rig.Seed.TblBulkJobs.Add(new TblBulkJob
        {
            JobNumber = "OLD", ClientCode = "ACME", FromAddress = "1 From Street", FromSuburb = "Otahuhu", FromPostCode = 1061,
            ToAddress = "9 Other Road", ToSuburb = "Onehunga", ToPostCode = 1061, ToCompany = "To Co",
            PickUpLatitude = "-36.91", PickUpLongitude = "174.81",
        });
        rig.Seed.SaveChanges();
        var first = Row("T1");
        var second = Row("T2");
        foreach (var row in new[] { first, second })
        {
            row.FromLatitude = null;
            row.FromLongitude = null;
        }

        await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, first, second));

        foreach (var row in new[] { first, second })
        {
            Assert.Equal("-36.91", row.FromLatitude);
            Assert.Equal("174.81", row.FromLongitude);
            Assert.Equal("1061", row.FromPostCode);
        }
    }

    [Fact]
    public async Task One_preflight_covers_the_whole_request()
    {
        var rig = NewRig();

        await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1"), Row("T2"), Row("T3")));

        await rig.Preflight.Received(1).RunAsync(Arg.Is<IReadOnlyList<TruckRowPlan>>(p => p.Count == 3));
    }

    [Fact]
    public async Task A_row_rated_at_zero_shows_the_reason_import_would_give()
    {
        var rig = NewRig();
        rig.Rate = plan => Priced(plan, 0m, 0m);

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1")));
        var import = await rig.Svc.Import(ContactId, OnDemand(Teco, Row("T1")));

        var row = Assert.Single(preview.Rows);
        Assert.True(preview.Success);
        Assert.False(row.WouldImport);
        Assert.Null(row.Amount);
        Assert.Contains("No truck rate", row.Reason);
        Assert.Equal(Assert.Single(import.Jobs).ErrorMessage, row.Reason);
    }

    [Fact]
    public async Task A_cross_region_row_is_flagged()
    {
        var rig = NewRig();
        rig.Rate = plan =>
        {
            var pre = Priced(plan, 50m, 2m);
            pre.IsLocal = false;
            return pre;
        };

        var row = Assert.Single((await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1")))).Rows);

        Assert.False(row.WouldImport);
        Assert.Contains("different regions", row.Reason);
    }

    [Fact]
    public async Task A_baggage_client_is_flagged_as_import_would_refuse_it()
    {
        var rig = NewRig();
        rig.Baggage = true;

        var row = Assert.Single((await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1")))).Rows);

        Assert.False(row.WouldImport);
        Assert.Equal("Truck jobs cannot be bulk imported for a baggage client.", row.Reason);
    }

    [Fact]
    public async Task A_speed_outside_the_list_and_one_the_client_lacks_are_flagged_in_file_order()
    {
        var rig = NewRig();

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(P2PSpeed, Row("T1", "TECO"), Row("C1", "CT"), Row("N1", "Nope")));

        Assert.Equal(new[] { 0, 1, 2 }, preview.Rows.Select(r => r.RowIndex));
        Assert.True(preview.Rows[0].WouldImport);
        Assert.Contains("Chilled Truck cannot be bulk imported", preview.Rows[1].Reason);
        Assert.Equal("Speed Nope is not available for this client.", preview.Rows[2].Reason);
    }

    [Fact]
    public async Task A_duplicate_number_in_the_file_flags_only_the_repeat()
    {
        var rig = NewRig();

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1"), Row("T1")));

        Assert.True(preview.Rows[0].WouldImport);
        Assert.Contains("appears more than once", preview.Rows[1].Reason);
    }

    [Fact]
    public async Task A_number_that_already_exists_is_flagged()
    {
        var rig = NewRig();
        rig.Rate = plan =>
        {
            var pre = Priced(plan, 50m, 2m);
            pre.JobNumberExists = true;
            return pre;
        };

        var row = Assert.Single((await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1")))).Rows);

        Assert.Equal("Job number T1 already exists.", row.Reason);
    }

    [Fact]
    public async Task A_failed_rate_check_flags_every_row_rather_than_failing_the_step()
    {
        var rig = NewRig();
        rig.Preflight.RunAsync(Arg.Any<IReadOnlyList<TruckRowPlan>>())
            .Returns<IReadOnlyList<TruckPreflightRow>>(_ => throw new InvalidOperationException("boom"));

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1"), Row("T2")));

        Assert.True(preview.Success);
        Assert.All(preview.Rows, r =>
        {
            Assert.False(r.WouldImport);
            Assert.False(string.IsNullOrWhiteSpace(r.Reason));
        });
    }

    [Fact]
    public async Task An_unrecognised_suburb_is_a_warning_on_a_row_that_still_imports()
    {
        var rig = NewRig();
        rig.Rate = plan =>
        {
            var pre = Priced(plan, 50m, 2m);
            pre.ToUnknown = true;
            return pre;
        };

        var row = Assert.Single((await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1")))).Rows);

        Assert.True(row.WouldImport);
        Assert.Null(row.Reason);
        Assert.Contains("was not recognised", row.Warning);
    }

    [Fact]
    public async Task A_staff_amount_shows_as_rated_manually_even_at_a_zero_rate()
    {
        var rig = NewRig("4");
        rig.Rate = plan => Priced(plan, 0m, 0m);
        var input = Row("T1");
        input.Amount = 88m;

        var row = Assert.Single((await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, input))).Rows);

        Assert.True(row.WouldImport);
        Assert.True(row.RatedManually);
        Assert.Equal(88m, row.Amount);
        Assert.Null(row.Rate);
        Assert.Null(row.Fuel);
    }

    [Fact]
    public async Task A_customer_amount_is_stripped_so_the_row_is_rated()
    {
        var rig = NewRig("2");
        var input = Row("T1");
        input.Amount = 1m;

        var row = Assert.Single((await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, input))).Rows);

        Assert.False(row.RatedManually);
        Assert.Equal(52.5m, row.Amount);
    }

    // ---- Steve ruling 6 -------------------------------------------------------

    [Fact]
    public async Task A_customer_never_receives_the_rate_or_fuel_and_gets_the_booking_page_figures()
    {
        // Enforced on the server: a hidden column would still be in the response.
        var rig = NewRig("2");
        rig.Preflight.PublicDescriptionsAsync(Arg.Any<IReadOnlyList<TruckPublicRateRow>>())
            .Returns(call => Task.FromResult<IReadOnlyDictionary<int, string?>>(
                call.Arg<IReadOnlyList<TruckPublicRateRow>>().ToDictionary(r => r.RowNo, _ => (string?)"Truck Economy = $40.00\rTail Lift Surcharge = $12.50")));

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1")));

        var row = Assert.Single(preview.Rows);
        Assert.True(preview.CustomerPricing);
        Assert.Null(row.Rate);
        Assert.Null(row.Fuel);
        Assert.Equal(52.5m, row.Amount);
        Assert.Equal(60.38m, row.AmountInclGst);
        Assert.Equal(new[] { "Truck Economy", "Tail Lift Surcharge" }, row.PriceLines!.Select(l => l.Label));
        NothingWasWritten(rig);
    }

    [Fact]
    public async Task The_customer_lines_are_asked_for_on_the_rows_resolved_route_and_what_the_insert_rates()
    {
        var rig = NewRig("2");
        var sent = new List<TruckPublicRateRow>();
        rig.Preflight.PublicDescriptionsAsync(Arg.Do<IReadOnlyList<TruckPublicRateRow>>(r => sent.AddRange(r)));
        var req = OnDemand(Teco, Row("T1", qty: 2));

        await rig.Svc.PreviewTruckRows(ContactId, req);

        var rate = Assert.Single(sent);
        Assert.Equal((ClientId, 10, 11, Teco, 500m, 2), (rate.ClientId, rate.FromId, rate.ToId, rate.Speed, rate.TotalWeight, rate.Qty));
    }

    [Fact]
    public async Task Staff_keep_rate_and_fuel_and_never_pay_for_the_customer_lookup()
    {
        var rig = NewRig("4");

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1")));

        var row = Assert.Single(preview.Rows);
        Assert.False(preview.CustomerPricing);
        Assert.Equal(50m, row.Rate);
        Assert.Equal(2.5m, row.Fuel);
        Assert.Null(row.AmountInclGst);
        Assert.Null(row.PriceLines);
        await rig.Preflight.DidNotReceiveWithAnyArgs().PublicDescriptionsAsync(default!);
    }

    // ---- Steve rulings 3 and 4 --------------------------------------------------

    [Fact]
    public async Task Both_weights_import_on_weight_with_a_warning_shown_in_the_preview()
    {
        var rig = NewRig();
        BulkImportJobCreateDto Both()
        {
            var row = Row("T1", qty: 2);
            row.TotalWeight = 900;
            return row;
        }

        var row = Assert.Single((await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Both()))).Rows);
        await rig.Svc.Import(ContactId, OnDemand(Teco, Both()));

        Assert.True(row.WouldImport);
        Assert.Contains("Weight was used", row.Warning);
        Assert.Null(row.WarningLevel);
        Assert.Equal(500m, Assert.Single(rig.Inserted).ucjbWeight);
    }

    [Fact]
    public async Task A_row_with_no_weight_or_dimensions_imports_and_is_amber_in_the_preview()
    {
        var rig = NewRig();
        BulkImportJobCreateDto Empty()
        {
            var row = Row("T1");
            row.Length = row.Width = row.Height = row.Weight = 0;
            return row;
        }

        var row = Assert.Single((await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Empty()))).Rows);
        await rig.Svc.Import(ContactId, OnDemand(Teco, Empty()));

        Assert.True(row.WouldImport);
        Assert.Equal("amber", row.WarningLevel);
        Assert.Contains("No weight, length, width, height", row.Warning);
        Assert.Single(rig.Inserted);
    }

    [Fact]
    public async Task A_stock_size_that_fills_the_blanks_is_not_flagged()
    {
        var rig = NewRig();
        rig.Seed.TblGssstockSizes.Add(new TblGssstockSize { Id = 1, Name = "Half Pallet", Length = 120, Width = 100, Height = 90, Weight = 250 });
        rig.Seed.SaveChanges();
        var input = Row("T1");
        input.Length = input.Width = input.Height = input.Weight = 0;
        input.PalletType = "Half Pallet";

        var row = Assert.Single((await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, input))).Rows);

        Assert.Null(row.WarningLevel);
        Assert.Null(row.Warning);
    }

    [Fact]
    public async Task A_customer_cannot_preview_another_clients_rows_and_gets_the_import_refusal()
    {
        var rig = NewRig("2");

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, OtherClientId, Row("T1")));
        var import = await rig.Svc.Import(ContactId, OnDemand(Teco, OtherClientId, Row("T1")));

        Assert.False(preview.Success);
        Assert.False(import.Success);
        Assert.Equal("Invalid client.", Assert.Single(preview.Messages).Message);
        Assert.Equal(Assert.Single(import.Messages).Message, preview.Messages[0].Message);
        Assert.Empty(preview.Rows);
        await rig.Preflight.DidNotReceiveWithAnyArgs().RunAsync(default!);
    }

    [Fact]
    public async Task A_customer_can_preview_their_own_client()
    {
        var rig = NewRig("2");

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1")));

        Assert.True(preview.Success);
        Assert.Single(preview.Rows);
    }

    [Fact]
    public async Task Autogenerated_numbers_are_previewed_without_consuming_any()
    {
        // sp_AssignJobNumbers goes through ExecuteSqlRaw, which throws on this
        // in-memory provider, so reaching it fails this test.
        var rig = NewRig();

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("AUTOGENERATE"), Row("autogenerate")));

        Assert.Equal(2, preview.Rows.Count);
        Assert.All(preview.Rows, r =>
        {
            Assert.True(r.WouldImport);
            Assert.Null(r.JobNumber);
        });
    }

    [Fact]
    public async Task P2P_rows_are_counted_but_not_priced_or_run()
    {
        var rig = NewRig();

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(Teco, Row("T1", "TECO"), Row("P1", "Standard"), Row("P2", "Standard")));

        Assert.Equal("T1", Assert.Single(preview.Rows).JobNumber);
        Assert.Equal(2, preview.OtherRowCount);
        NothingWasWritten(rig);
    }

    [Fact]
    public async Task A_past_book_date_is_refused_as_import_refuses_it()
    {
        var rig = NewRig();
        var req = OnDemand(Teco, Row("T1"));
        req.BookDate = new DateTime(2001, 1, 1);

        var preview = await rig.Svc.PreviewTruckRows(ContactId, req);

        Assert.False(preview.Success);
        Assert.Equal("Book date must be in the future.", Assert.Single(preview.Messages).Message);
    }

    [Theory]
    [InlineData("NZ", "routed")]
    [InlineData("US", "ondemand")]
    public async Task Routed_and_us_imports_have_nothing_to_preview(string tenant, string jobType)
    {
        var rig = NewRig(tenant: tenant);
        var req = OnDemand(Teco, Row("T1", "TECO"));
        req.JobType = jobType;

        var preview = await rig.Svc.PreviewTruckRows(ContactId, req);

        Assert.True(preview.Success);
        Assert.Empty(preview.Rows);
        Assert.Equal(1, preview.OtherRowCount);
        await rig.Preflight.DidNotReceiveWithAnyArgs().RunAsync(default!);
    }
}
