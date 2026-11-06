// M5a pin (card bulk-insert-truck-and-ai). Written and passed against 5fee7f6,
// before any item-line code, to hold what the job procs receive on the paths the
// wizard guard tests do not cover: US wizard, NZ staff, US staff. M5a changes what
// happens after the job exists, never how the job is booked. A failure here means
// the item work moved the booking call, so do not change the expected values.
//
// One deliberate change since then (Kevin, 6 Nov, Steve's M5a rule "same as the
// booking page"): the booking call gets the total weight, and US gets the page's
// cubic. The per-item pins at the bottom of this file are what that decision holds.
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

public partial class BulkP2PJobPinTests
{
    private sealed class RecordingContext(DbContextOptions options, IDespatchContextProcedures procs)
        : DynamicDespatchDbContext(options)
    {
        public override IDespatchContextProcedures Procedures { get => procs; set { } }
    }

    private sealed class NoHttpFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new BulkImportServiceV2CoreTests.FakeHandler());
    }

    private sealed record Rig(BulkImportServiceV2 Svc, DynamicDespatchDbContext Seed, IDespatchContextProcedures Procs, IBulkP2PItemInserter Items);

    private const int ClientId = 5;
    private const int Speed = 3;
    private const int ContactId = 1;
    private static readonly DateTime BookDate = new(2031, 3, 4, 9, 30, 15);

    private static Rig NewRig(string country, int? usJobId = 900, string? usMessage = null, IBulkTruckPreflight? preflight = null)
    {
        var options = BulkImportTestHarness.NewOptions();
        var procs = Substitute.For<IDespatchContextProcedures>();
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new RecordingContext(options, procs));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult<DynamicDespatchDbContext>(new RecordingContext(options, procs)));

        var accessor = BulkImportTestHarness.Accessor(country, "4", "UTC");
        var scope = new BulkClientScope(accessor);
        var here = new HereGeocodeService(
            new HttpClient(new BulkImportServiceV2CoreTests.FakeHandler()),
            new AppSettings { HereMapsApiKey = string.Empty });
        var address = new AddressService(factory, accessor, here, BulkImportTestHarness.Cache(accessor), scope);
        var items = Substitute.For<IBulkP2PItemInserter>();
        items.InsertAsync(default!, default).ReturnsForAnyArgs(Array.Empty<P2PItemFailure>());
        var svc = TruckTestFakes.NewService(factory, new NoHttpFactory(), accessor, address, scope, preflight, itemInserter: items);

        var seed = BulkImportTestHarness.Context(options);
        seed.TucClients.Add(new TucClient { UcclId = ClientId, UcclCode = "ACME", UcclName = "Acme", UcclActive = true, JobPrefix = "AC" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = Speed, UcjtName = "Standard", SystemName = "ST", ZoneRated = false });
        seed.TucClientContacts.Add(new TucClientContact { UcctId = ContactId, UcctFirstname = "Pat", UcctSurname = "Test", UcctEmail = "pat@example.invalid", StaffId = 77 });
        seed.TucNoteTypes.Add(new TucNoteType { NoteTypeId = 1, NoteTypeName = "Delivery Notes", Description = "", IsActive = true });
        seed.TucJobs.Add(new TucJob { UcjbId = 900, UcjbNumber = "S1" });
        seed.SaveChanges();

        // The US proc hands the new id back through an output parameter. Its 91
        // parameters are all nullable, so the stub is set up by reflection.
        var usProc = typeof(IDespatchContextProcedures).GetMethod(nameof(IDespatchContextProcedures.DD_stpJob_InsertExceleratorAsync))!;
        var usNames = usProc.GetParameters();
        procs.WhenForAnyArgs(p => usProc.Invoke(p, new object?[usNames.Length]))
            .Do(call =>
            {
                for (int i = 0; i < usNames.Length; i++)
                {
                    if (usNames[i].Name == "jobID") Set(call.Args()[i], usJobId);
                    if (usNames[i].Name == "message") Set(call.Args()[i], usMessage);
                }
            });
        return new Rig(svc, seed, procs, items);
    }

    private static void Set(object? output, object? value) =>
        output!.GetType().GetMethod("SetValue", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(output, new[] { value });

    private static List<Dictionary<string, object?>> CallsTo(IDespatchContextProcedures procs, string method) =>
        procs.ReceivedCalls().Where(c => c.GetMethodInfo().Name == method).Select(ToArguments).ToList();

    private static Dictionary<string, object?> ToArguments(ICall call)
    {
        var names = call.GetMethodInfo().GetParameters().Select(p => p.Name!).ToArray();
        return names.Zip(call.GetArguments()).ToDictionary(p => p.First, p => p.Second);
    }

    private static BulkImportRequest UsRequest() => new()
    {
        ClientId = ClientId,
        SpeedId = Speed,
        BookDate = BookDate,
        JobType = "ondemand",
        Jobs = new List<BulkImportJobCreateDto>
        {
            new()
            {
                JobNumber = "US1", FromContact = "Sender", FromCompany = "From Co", FromAddress = "1 From St",
                FromCity = "Dallas", FromState = "TX", FromZipCode = "75201",
                ToCompany = "To Co", ToAddress = "2 To St", ToCity = "Austin", ToState = "TX", ToZipCode = "73301",
                ToContact = "Receiver", ToContactPhone = "000", Quantity = 2,
                Length = 50m, Width = 40m, Height = 30m, Weight = 12.5m, Notes = "row note",
            },
        },
    };

    private static StaffImportRequest StaffRequest(int speed = Speed) => new()
    {
        Jobs = new List<Dictionary<string, object>>
        {
            new()
            {
                { "ClientID", ClientId }, { "JobNumber", "S1" }, { "Speed", speed }, { "Qty", 2 }, { "Weight", 12.5 },
                { "Length", 50 }, { "Width", 40 }, { "Height", 30 }, { "Notes", "row note" },
                { "FromAddress", "1 From St" }, { "FromSuburb", "Otahuhu" }, { "ToAddress", "2 To St" }, { "ToSuburb", "Albany" },
            },
        },
    };

    [Fact]
    public async Task Us_wizard_row_books_with_the_total_weight_and_cubic()
    {
        var rig = NewRig("US");

        var resp = await rig.Svc.Import(ContactId, UsRequest());

        Assert.True(resp.Success, string.Join(" | ", resp.Messages.Select(m => m.Message)));
        var call = Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        Assert.Equal("US1", call["jobNumber"]);
        Assert.Equal("2", call["quantity"]);
        Assert.Equal("25.0", call["totalWeight"]);
        Assert.Equal(69.48m, call["cubic"]);
        Assert.Equal("row note", call["clientNotes"]);
        Assert.Equal(string.Empty, call["cubicList"]);
        Assert.Equal(string.Empty, call["weightList"]);
        Assert.Equal(string.Empty, call["barcodeList"]);
        Assert.Equal(3, call["sourceId"]);
    }

    [Fact]
    public async Task Nz_staff_row_books_with_the_total_weight()
    {
        var rig = NewRig("NZ");

        var resp = await rig.Svc.StaffImport(ContactId, StaffRequest());

        Assert.Equal(1, resp.SuccessCount);
        var call = Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"));
        Assert.Equal("S1", call["jobNumber"]);
        Assert.Equal((short)2, call["qty"]);
        Assert.Equal(25d, call["weight"]);
        Assert.Equal("row note", call["notes"]);
        Assert.Equal(3, call["sourceID"]);
    }

    [Fact]
    public async Task Us_staff_row_books_with_the_total_weight_and_cubic()
    {
        var rig = NewRig("US");

        var resp = await rig.Svc.StaffImport(ContactId, StaffRequest());

        Assert.Equal(1, resp.SuccessCount);
        var call = Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        Assert.Equal("S1", call["jobNumber"]);
        Assert.Equal("2", call["quantity"]);
        Assert.Equal("25.0", call["totalWeight"]);
        Assert.Equal(69.48m, call["cubic"]);
        Assert.Equal(3, call["sourceId"]);
    }

    // ---- M5a: what happens after the job exists ----------------------------

    private static P2PItemJob SentJob(Rig rig, bool expectedIsNz)
    {
        var call = Assert.Single(rig.Items.ReceivedCalls());
        Assert.Equal(expectedIsNz, call.GetArguments()[1]);
        return Assert.Single((IReadOnlyList<P2PItemJob>)call.GetArguments()[0]!);
    }

    private static BulkImportRequest NzRequest()
    {
        var req = UsRequest();
        var row = req.Jobs.Single();
        row.JobNumber = "S1";
        row.Notes = null;
        row.ToPostCode = "632";
        return req;
    }

    private static StaffImportRequest StaffRequestNoNotes(int speed = Speed)
    {
        var req = StaffRequest(speed);
        req.Jobs.Single().Remove("Notes");
        return req;
    }

    private static void AssertNoPerRowItemProc(Rig rig) =>
        Assert.Empty(CallsTo(rig.Procs, "NET_stpBulkJobItems_InsertAsync"));

    [Fact]
    public async Task Nz_wizard_row_sends_its_tucJob_id_and_sizes_to_the_batch_and_never_calls_the_item_proc()
    {
        var rig = NewRig("NZ");

        await rig.Svc.Import(ContactId, NzRequest());

        Assert.Equal(new P2PItemJob(900, "S1", 2, 50m, 40m, 30m, 12.5m), SentJob(rig, expectedIsNz: true));
        AssertNoPerRowItemProc(rig);
    }

    [Fact]
    public async Task Us_wizard_row_sends_the_id_the_proc_returned_and_the_stock_size_name()
    {
        var rig = NewRig("US");
        var req = UsRequest();
        req.Jobs.Single().Notes = null;
        req.Jobs.Single().PackageName = "A4 SATCHEL";

        await rig.Svc.Import(ContactId, req);

        Assert.Equal(new P2PItemJob(900, "US1", 2, 50m, 40m, 30m, 12.5m, "A4 SATCHEL"), SentJob(rig, expectedIsNz: false));
        AssertNoPerRowItemProc(rig);
    }

    [Fact]
    public async Task Nz_staff_row_now_carries_its_sizes_to_the_item_lines()
    {
        // The old call passed NULL dimensions for every staff row.
        var rig = NewRig("NZ");

        await rig.Svc.StaffImport(ContactId, StaffRequestNoNotes());

        Assert.Equal(new P2PItemJob(900, "S1", 2, 50m, 40m, 30m, 12.5m), SentJob(rig, expectedIsNz: true));
        AssertNoPerRowItemProc(rig);
    }

    [Fact]
    public async Task Us_staff_row_sends_the_id_the_proc_returned()
    {
        var rig = NewRig("US");

        await rig.Svc.StaffImport(ContactId, StaffRequestNoNotes());

        Assert.Equal(new P2PItemJob(900, "S1", 2, 50m, 40m, 30m, 12.5m), SentJob(rig, expectedIsNz: false));
        AssertNoPerRowItemProc(rig);
    }

    [Fact]
    public async Task Us_staff_schedule_speed_keeps_the_bulk_item_proc_because_the_id_is_a_bulk_job()
    {
        // DD_stpJob_InsertExcelerator takes its schedule branch at LEN(@SpeedID) >= 4
        // and returns a tblBulkJob id. A tucJobItems insert would hit a foreign job.
        var rig = NewRig("US");

        await rig.Svc.StaffImport(ContactId, StaffRequestNoNotes(speed: 12003));

        Assert.Empty((IReadOnlyList<P2PItemJob>)Assert.Single(rig.Items.ReceivedCalls()).GetArguments()[0]!);
        Assert.Equal(2, CallsTo(rig.Procs, "NET_stpBulkJobItems_InsertAsync").Count);
    }

    [Fact]
    public async Task A_failed_item_batch_warns_and_still_counts_the_job_as_created()
    {
        // Showing the row as failed would invite a re-import, which books it twice.
        var rig = NewRig("NZ");
        rig.Items.InsertAsync(default!, default).ReturnsForAnyArgs(new[] { new P2PItemFailure("S1", "boom") });

        var resp = await rig.Svc.Import(ContactId, NzRequest());

        Assert.True(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Job S1 was created, but its item lines could not be saved: boom");
        Assert.Contains(resp.Messages, m => m.Message.Contains("1 job(s) were created"));
    }

    [Fact]
    public async Task A_row_whose_new_job_cannot_be_found_gets_no_item_lines()
    {
        var rig = NewRig("NZ");
        rig.Seed.TucJobs.RemoveRange(rig.Seed.TucJobs);
        rig.Seed.SaveChanges();

        await rig.Svc.Import(ContactId, NzRequest());

        Assert.Empty(((IReadOnlyList<P2PItemJob>)Assert.Single(rig.Items.ReceivedCalls()).GetArguments()[0]!));
    }

    // ---- Weight is per item, the job rates and books on the total ---------------
    //
    // The booking page's worked example: 3 items at 12.5, 50 x 40 x 30. The page
    // sends 37.5 on both tenants (JobRepository.cs:1375, :1203). US cubic per item is
    // 50 x 40 x 30 x 0.000579 = 34.74, rounded to 3 places (desktopHomeControl.js:3507),
    // and the page multiplies it by the units (JobRepository.cs:1204): 104.22.

    private const decimal UsWorkedCubic = 104.22m;

    private static BulkImportRequest WizardRow(string country, short? qty, decimal weight, decimal? total = null, string? package = null)
    {
        var req = country == "NZ" ? NzRequest() : UsRequest();
        var row = req.Jobs.Single();
        row.Notes = null;
        row.Quantity = qty;
        row.Weight = weight;
        row.TotalWeight = total;
        row.PackageName = package;
        return req;
    }

    private static StaffImportRequest StaffRow(object? qty, object? weight, object? total = null, int speed = Speed)
    {
        var req = StaffRequestNoNotes(speed);
        var row = req.Jobs.Single();
        row.Remove("Qty");
        row.Remove("Weight");
        if (qty != null) row["Qty"] = qty;
        if (weight != null) row["Weight"] = weight;
        if (total != null) row["Total Weight"] = total;
        return req;
    }

    // What the rate call and the job insert get, and what the trigger adds up afterwards.
    private static void AssertNzBooked(Rig rig, short qty, double total, decimal perItem)
    {
        var call = Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"));
        Assert.Equal(qty, call["qty"]);
        Assert.Equal(total, call["weight"]);
        Assert.DoesNotContain("cubic", call.Keys);
        AssertItems(rig, expectedIsNz: true, perItem, total);
    }

    private static void AssertUsBooked(Rig rig, string qty, string total, decimal cubic, decimal perItem)
    {
        var call = Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        Assert.Equal(qty, call["quantity"]);
        Assert.Equal(total, call["totalWeight"]);
        Assert.Equal(cubic, call["cubic"]);
        var items = AssertItems(rig, expectedIsNz: false, perItem, double.Parse(total, System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(cubic, items.Sum(i => i.Cubic));
    }

    private static IReadOnlyList<P2PItemRow> AssertItems(Rig rig, bool expectedIsNz, decimal perItem, double total)
    {
        var job = SentJob(rig, expectedIsNz);
        Assert.Equal(perItem, job.Weight);
        var items = P2PItemCalculator.BuildItems(job, expectedIsNz);
        Assert.All(items, i => Assert.Equal((double)perItem, i.Weight));
        Assert.Equal(total, items.Sum(i => i.Weight));
        return items;
    }

    [Fact]
    public async Task Worked_example_nz_wizard()
    {
        var rig = NewRig("NZ");
        await rig.Svc.Import(ContactId, WizardRow("NZ", 3, 12.5m));
        AssertNzBooked(rig, 3, 37.5d, 12.5m);
    }

    [Fact]
    public async Task Worked_example_us_wizard()
    {
        var rig = NewRig("US");
        await rig.Svc.Import(ContactId, WizardRow("US", 3, 12.5m));
        AssertUsBooked(rig, "3", "37.5", UsWorkedCubic, 12.5m);
    }

    [Fact]
    public async Task Worked_example_nz_staff()
    {
        var rig = NewRig("NZ");
        await rig.Svc.StaffImport(ContactId, StaffRow(3, 12.5));
        AssertNzBooked(rig, 3, 37.5d, 12.5m);
    }

    [Fact]
    public async Task Worked_example_us_staff()
    {
        var rig = NewRig("US");
        await rig.Svc.StaffImport(ContactId, StaffRow(3, 12.5));
        AssertUsBooked(rig, "3", "37.5", UsWorkedCubic, 12.5m);
    }

    [Fact]
    public async Task Total_weight_only_nz_wizard_is_12_5_per_item_and_rated_on_37_5()
    {
        var rig = NewRig("NZ");
        await rig.Svc.Import(ContactId, WizardRow("NZ", 3, 0m, total: 37.5m));
        AssertNzBooked(rig, 3, 37.5d, 12.5m);
    }

    [Fact]
    public async Task Total_weight_only_us_wizard_is_12_5_per_item_and_rated_on_37_5()
    {
        var rig = NewRig("US");
        await rig.Svc.Import(ContactId, WizardRow("US", 3, 0m, total: 37.5m));
        AssertUsBooked(rig, "3", "37.5", UsWorkedCubic, 12.5m);
    }

    [Fact]
    public async Task Total_weight_only_nz_staff_is_12_5_per_item_and_rated_on_37_5()
    {
        var rig = NewRig("NZ");
        await rig.Svc.StaffImport(ContactId, StaffRow(3, null, total: 37.5));
        AssertNzBooked(rig, 3, 37.5d, 12.5m);
    }

    [Fact]
    public async Task Total_weight_only_us_staff_is_12_5_per_item_and_rated_on_37_5()
    {
        var rig = NewRig("US");
        await rig.Svc.StaffImport(ContactId, StaffRow(3, null, total: 37.5));
        AssertUsBooked(rig, "3", "37.5", UsWorkedCubic, 12.5m);
    }

    [Fact]
    public async Task Weight_wins_when_a_row_gives_both()
    {
        var wizard = NewRig("NZ");
        await wizard.Svc.Import(ContactId, WizardRow("NZ", 3, 12.5m, total: 99m));
        AssertNzBooked(wizard, 3, 37.5d, 12.5m);

        var staff = NewRig("US");
        await staff.Svc.StaffImport(ContactId, StaffRow(3, 12.5, total: 99));
        AssertUsBooked(staff, "3", "37.5", UsWorkedCubic, 12.5m);
    }

    [Fact]
    public async Task A_stock_size_weight_is_per_item_and_multiplied_like_any_other_row()
    {
        // The wizard puts the stock weight in Weight. A stock size is not rounded to 3
        // places first: 11 x 16 x 1 x 0.000579 = 0.101904, stored as .1019 per item
        // (US job 40050 on the booking page), .3057 for three. Typed would be .306.
        var rig = NewRig("US");
        var req = WizardRow("US", 3, 15m, package: "A4 SATCHEL");
        var row = req.Jobs.Single();
        (row.Length, row.Width, row.Height) = (11m, 16m, 1m);
        await rig.Svc.Import(ContactId, req);
        AssertUsBooked(rig, "3", "45", 0.3057m, 15m);
    }

    [Theory]
    [InlineData(null)]
    [InlineData((short)0)]
    [InlineData((short)-2)]
    public async Task A_quantity_that_is_missing_or_below_1_counts_as_1(short? qty)
    {
        var rig = NewRig("NZ");
        await rig.Svc.Import(ContactId, WizardRow("NZ", qty, 12.5m));

        var call = Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"));
        Assert.Equal(12.5d, call["weight"]);
        Assert.Equal(qty ?? (short)1, call["qty"]);
    }

    [Fact]
    public async Task Nz_staff_row_with_no_weight_at_all_still_sends_null()
    {
        var rig = NewRig("NZ");
        await rig.Svc.StaffImport(ContactId, StaffRow(3, null));

        Assert.Null(Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"))["weight"]);
    }

    [Fact]
    public async Task Us_staff_schedule_speed_keeps_the_raw_weight_and_no_cubic()
    {
        // A schedule booking is out of scope for the per-item rule.
        var rig = NewRig("US");
        await rig.Svc.StaffImport(ContactId, StaffRow(3, 12.5, speed: 12003));

        var call = Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        Assert.Equal(12.5d.ToString(), call["totalWeight"]);
        Assert.Equal(0m, call["cubic"]);
    }

    [Theory]
    [InlineData(3000, true)]
    [InlineData(3003, false)]
    public async Task In_a_truck_file_the_p2p_weight_cap_applies_to_what_each_item_comes_to(int total, bool imported)
    {
        var rig = NewRig("NZ");
        var req = WizardRow("NZ", 3, 0m, total: total);
        req.TruckDefaults = new BulkTruckDefaults();

        var resp = await rig.Svc.Import(ContactId, req);

        Assert.Equal(imported ? 1 : 0, CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync").Count);
        Assert.Equal(!imported, resp.Messages.Any(m => m.Message.Contains("Weight must be 1000 or less on a non-truck job.")));
    }

    [Fact]
    public async Task A_total_only_row_picks_the_vehicle_on_what_each_item_weighs()
    {
        var rig = NewRig("NZ");
        await rig.Svc.Import(ContactId, WizardRow("NZ", 3, 0m, total: 1500m));

        Assert.Equal((short)3, Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"))["size"]);
    }

    // ---- US staff: a proc refusal is a failed row, not "1 succeeded" ---------------
    //
    // DD_stpJob_InsertExcelerator's validation exit (RETURN at its line 513) raises
    // nothing, it only leaves @JobID NULL and @Message set. Reporting that as a success
    // told staff a job exists when none does.

    private static void AssertRowFailed(Rig rig, StaffImportResponse resp, string expectedError)
    {
        Assert.Equal(0, resp.SuccessCount);
        Assert.False(resp.Success);
        var failed = Assert.Single(resp.FailedJobs);
        Assert.Equal(1, failed.RowNumber);
        Assert.Equal("S1", failed.JobNumber);
        Assert.Equal(expectedError, failed.Error);
        Assert.Empty((IReadOnlyList<P2PItemJob>)Assert.Single(rig.Items.ReceivedCalls()).GetArguments()[0]!);
        AssertNoPerRowItemProc(rig);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    public async Task Us_staff_row_the_proc_refused_fails_with_the_procs_message(int? returnedId)
    {
        var rig = NewRig("US", usJobId: returnedId, usMessage: "Require \"Reference A\" - \"cat\"");

        var resp = await rig.Svc.StaffImport(ContactId, StaffRequest());

        AssertRowFailed(rig, resp, "Require \"Reference A\" - \"cat\"");
        Assert.Empty(rig.Seed.TucNotes);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public async Task Us_staff_refusal_with_no_message_uses_the_same_text_as_the_wizard(string? message)
    {
        var rig = NewRig("US", usJobId: null, usMessage: message);

        var resp = await rig.Svc.StaffImport(ContactId, StaffRequest());

        AssertRowFailed(rig, resp, "Stored procedure returned a failure status with no error message.");
    }

    [Fact]
    public async Task Us_staff_schedule_speed_refusal_also_fails_the_row()
    {
        // The proc's validation exit sits before its schedule branch, so the same outcome applies.
        var rig = NewRig("US", usJobId: null, usMessage: "\"Speed\" is schedule only");

        var resp = await rig.Svc.StaffImport(ContactId, StaffRequestNoNotes(speed: 12003));

        AssertRowFailed(rig, resp, "\"Speed\" is schedule only");
    }

    // ---- US staff: blank coordinates reach the proc as NULL ------------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task Us_staff_blank_or_missing_coordinates_are_passed_as_null(string? blank)
    {
        // '' fails converting to tucJob's decimal(18,9) coordinate columns.
        var rig = NewRig("US");
        var req = StaffRequestNoNotes();
        if (blank != null)
        {
            var row = req.Jobs.Single();
            foreach (var column in new[] { "PickUpLatitude", "PickUpLongitude", "DeliveryLatitude", "DeliveryLongitude" })
                row[column] = blank;
        }

        await rig.Svc.StaffImport(ContactId, req);

        var call = Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        Assert.Null(call["pickUpLatitude"]);
        Assert.Null(call["pickUpLongitude"]);
        Assert.Null(call["deliveryLatitude"]);
        Assert.Null(call["deliveryLongitude"]);
    }

    [Fact]
    public async Task Us_staff_real_coordinates_still_reach_the_proc()
    {
        var rig = NewRig("US");
        var req = StaffRequestNoNotes();
        var row = req.Jobs.Single();
        row["PickUpLatitude"] = "32.7767";
        row["PickUpLongitude"] = "-96.797";
        row["DeliveryLatitude"] = "30.2672";
        row["DeliveryLongitude"] = "-97.7431";

        await rig.Svc.StaffImport(ContactId, req);

        var call = Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        Assert.Equal("32.7767", call["pickUpLatitude"]);
        Assert.Equal("-96.797", call["pickUpLongitude"]);
        Assert.Equal("30.2672", call["deliveryLatitude"]);
        Assert.Equal("-97.7431", call["deliveryLongitude"]);
    }

    // ---- US staff: the row's BookDate decides the day a P2P job books for ----------

    private static StaffImportRequest DatedStaffRow(int speed = Speed, object? bookDate = null, object? bookTime = null)
    {
        var req = StaffRequestNoNotes(speed);
        var row = req.Jobs.Single();
        if (bookDate != null) row["BookDate"] = bookDate;
        if (bookTime != null) row["BookTime"] = bookTime;
        return req;
    }

    [Fact]
    public async Task Us_staff_p2p_row_with_a_BookDate_and_no_time_books_that_day_at_tenant_now()
    {
        // With NULL the proc books "now" (its lines 437-441), so a file dated next week booked today.
        var rig = NewRig("US");

        await rig.Svc.StaffImport(ContactId, DatedStaffRow(bookDate: "2031-03-04"));

        var call = Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        var time = Assert.IsType<DateTime>(call["time"]);
        var tenantNow = Assert.IsType<DateTime>(call["tenantCurrentTime"]);
        Assert.Equal(new DateTime(2031, 3, 4), time.Date);
        // Allows for the clock passing midnight between the two reads.
        var gap = Math.Abs((time.TimeOfDay - tenantNow.TimeOfDay).TotalSeconds);
        Assert.True(Math.Min(gap, 86400 - gap) < 5, $"time {time:O} is not tenant now {tenantNow:O}");
    }

    [Fact]
    public async Task Us_staff_p2p_row_with_a_BookDate_and_a_time_books_that_day_at_that_time()
    {
        var rig = NewRig("US");

        await rig.Svc.StaffImport(ContactId, DatedStaffRow(bookDate: "2031-03-04", bookTime: "14:30"));

        Assert.Equal(new DateTime(2031, 3, 4, 14, 30, 0), Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"))["time"]);
    }

    [Fact]
    public async Task Us_staff_p2p_row_with_no_BookDate_still_lets_the_proc_book_now()
    {
        // bookDate would fall back to DateTime.Today, the host's date, not the tenant's.
        var rig = NewRig("US");

        await rig.Svc.StaffImport(ContactId, DatedStaffRow());

        Assert.Null(Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"))["time"]);
    }

    [Fact]
    public async Task Us_staff_schedule_speed_still_ignores_BookDate()
    {
        var rig = NewRig("US");

        await rig.Svc.StaffImport(ContactId, DatedStaffRow(speed: 12003, bookDate: "2031-03-04"));

        var call = Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        Assert.Null(call["time"]);
        Assert.Null(call["pickupReadyDateTime"]);
    }

    [Fact]
    public async Task Us_staff_schedule_speed_still_sends_the_rows_time_as_it_came()
    {
        var rig = NewRig("US");
        var bookTime = new DateTime(2031, 5, 6, 14, 30, 0);

        await rig.Svc.StaffImport(ContactId, DatedStaffRow(speed: 12003, bookDate: "2031-03-04", bookTime: bookTime));

        var call = Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        Assert.Equal(bookTime, call["time"]);
        Assert.Equal(bookTime, call["pickupReadyDateTime"]);
    }

    [Fact]
    public async Task Nz_staff_row_still_sends_BookDate_and_a_null_time_separately()
    {
        // INT_stpJob_BulkInsert stores @BookDate as the job date and defaults only @BookTime.
        var rig = NewRig("NZ");

        await rig.Svc.StaffImport(ContactId, DatedStaffRow(bookDate: "2031-03-04"));

        var call = Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"));
        Assert.Equal(new DateTime(2031, 3, 4), call["bookDate"]);
        Assert.Null(call["bookTime"]);
    }
}
