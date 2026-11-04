// Why these exist: every rule below keeps a bulk truck job the same as one booked
// on the booking page, or is one of Steve's 4 Nov decisions. A price or an
// item row that drifts is invisible until an invoice is queried.
using System.Text.Json;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

public class TruckRowCalculatorTests
{
    private static readonly DateTime Book = new(2031, 3, 4, 9, 30, 15);
    private static readonly TruckClientFacts Client = new(5, "ACME", null, false, false, null, false, null);

    private static BulkImportJobCreateDto Row(Action<BulkImportJobCreateDto>? change = null)
    {
        var job = new BulkImportJobCreateDto
        {
            JobNumber = "T1",
            FromContact = "Sender Name",
            FromCompany = "From Co",
            FromAddress = "17 Saleyards Road",
            FromSuburb = "Otahuhu",
            ToCompany = "To Co",
            ToAddress = "2 To Street",
            ToSuburb = "Otahuhu",
            Quantity = 2,
            Length = 120,
            Width = 100,
            Height = 180,
            Weight = 250,
        };
        change?.Invoke(job);
        return job;
    }

    private static TruckRowInput Input(BulkImportJobCreateDto job, int? courier = null) => new()
    {
        Job = job,
        ClientId = 5,
        SpeedId = 52,
        BookDateTime = Book,
        CourierId = courier,
    };

    private static TruckRowPlan Plan(BulkImportJobCreateDto job, int? courier = null, TruckClientFacts? client = null)
    {
        var result = TruckRowCalculator.Prepare(Input(job, courier), client ?? Client);
        Assert.Null(result.Error);
        return result.Plan!;
    }

    private static TruckPreflightRow Pre(Action<TruckPreflightRow>? change = null)
    {
        var pre = new TruckPreflightRow
        {
            FromSuburbId = 10,
            ToSuburbId = 10,
            IsLocal = true,
            EffectiveSpeedId = 52,
            Rate = 41.4287m,
            Fuel = 3.0657m,
            ServerNow = new DateTime(2031, 3, 1, 8, 0, 0),
        };
        change?.Invoke(pre);
        return pre;
    }

    private static TruckInsertRow Finalized(BulkImportJobCreateDto job, TruckPreflightRow? pre = null, int? courier = null)
    {
        var result = TruckRowCalculator.Finalize(Plan(job, courier), pre ?? Pre(), Client);
        Assert.Null(result.Error);
        return result.Row!;
    }

    private static string FinalizeError(BulkImportJobCreateDto job, TruckPreflightRow pre)
    {
        var result = TruckRowCalculator.Finalize(Plan(job), pre, Client);
        Assert.Null(result.Row);
        return result.Error!;
    }

    // ---- v1 speeds (decision 4) --------------------------------------------

    [Fact]
    public void The_v1_truck_speeds_are_exactly_the_six_Steve_listed()
    {
        // Super, Express, Standard, Hourly, Bulk, Economy. 46, 124, 125 and 150-156
        // always rate $0 or can be swapped by the WS speed check.
        Assert.Equal(new[] { 41, 42, 43, 44, 51, 52 }, BulkTruckSpeeds.Allowed.OrderBy(s => s));
    }

    // ---- weight (decision 2) ------------------------------------------------

    [Fact]
    public void A_weight_column_is_per_pallet_so_the_total_is_weight_times_pallets()
    {
        var plan = Plan(Row());
        Assert.Equal(250m, plan.WeightPerPallet);
        Assert.Equal(500m, plan.TotalWeight);
        Assert.All(plan.Items, i => Assert.Equal(250d, i.Weight));
    }

    [Fact]
    public void Total_weight_is_divided_by_the_pallet_count_when_there_is_no_weight()
    {
        var plan = Plan(Row(j => { j.Weight = 0; j.TotalWeight = 500; }));
        Assert.Equal(250m, plan.WeightPerPallet);
        Assert.Equal(500m, plan.TotalWeight);
    }

    [Fact]
    public void When_both_are_given_weight_is_used_and_nothing_is_rejected()
    {
        // Steve has not ruled on this. There must be no mismatch check here: the
        // disagreeing figures below still import, on Weight. Open for Steve.
        var plan = Plan(Row(j => { j.Weight = 250; j.TotalWeight = 9999; }));
        Assert.Equal(250m, plan.WeightPerPallet);
        Assert.Equal(500m, plan.TotalWeight);
    }

    [Fact]
    public void No_weight_at_all_is_not_a_new_rejection()
    {
        // P2P imports zero weight today; Steve set no rule for trucks.
        var plan = Plan(Row(j => j.Weight = 0));
        Assert.Equal(0m, plan.TotalWeight);
    }

    // ---- rating inputs -------------------------------------------------------

    [Fact]
    public void Tail_lift_is_charged_per_unit_so_the_count_is_the_pallet_count()
    {
        var plan = Plan(Row(j => { j.Quantity = 3; j.TailLiftDropoff = true; }));
        Assert.Equal(0, plan.TailLiftPickupCount);
        Assert.Equal(3, plan.TailLiftDropoffCount);
        Assert.All(plan.Items, i => { Assert.False(i.PU); Assert.True(i.DO); });
    }

    [Fact]
    public void The_rate_function_receives_the_total_weight_as_its_average_weight()
    {
        // WS_stpJob_Insert passes the row total to @AverageWeight despite the name.
        using var doc = JsonDocument.Parse(BulkTruckPreflight.BuildRowsJson(new[] { Plan(Row()) }));
        Assert.Equal(500m, doc.RootElement[0].GetProperty("TotalWeight").GetDecimal());
    }

    [Fact]
    public void Fuel_uses_the_book_date_not_today()
    {
        // INT_stpJob_BulkInsert passes an unset @Date, which misses client fuel
        // rates. That P2P bug must not be copied onto trucks.
        Assert.Contains("UTL_fncFuelSurcharge_ExclusiveAmount(r.ClientId, CONVERT(date, r.BookDate)", BulkTruckPreflight.RowsSql);
        using var doc = JsonDocument.Parse(BulkTruckPreflight.BuildRowsJson(new[] { Plan(Row()) }));
        Assert.Equal("2031-03-04T09:30:15.000", doc.RootElement[0].GetProperty("BookDate").GetString());
    }

    // Package.GetOverSizeItems, including its integer truncation.
    [Theory]
    [InlineData(120, 120, 2, 0)]
    [InlineData(121, 100, 2, 2)]
    [InlineData(240, 100, 3, 6)]
    [InlineData(100, 121, 4, 4)]
    [InlineData(240, 240, 1, 5)]
    public void Oversize_count_matches_the_booking_api(int length, int width, short units, int expected) =>
        Assert.Equal(expected, TruckRowCalculator.OverSizeItems(length, width, units));

    [Fact]
    public void Overweight_counts_every_pallet_above_the_clients_limit()
    {
        Assert.Equal(2, Plan(Row(j => j.Weight = 751)).OverWeightItems);
        Assert.Equal(0, Plan(Row(j => j.Weight = 750)).OverWeightItems);
        var strict = Client with { TruckWeightLimit = 100 };
        Assert.Equal(2, Plan(Row(), client: strict).OverWeightItems);
    }

    // ---- items --------------------------------------------------------------

    [Fact]
    public void Items_are_one_row_per_pallet_with_width_in_depth()
    {
        var plan = Plan(Row(j => j.PalletType = "Half Pallet"));
        Assert.Equal(2, plan.Items.Count);
        var first = plan.Items[0];
        Assert.Equal(0, first.ItemId);
        Assert.Equal(1, first.Items);
        Assert.Equal(120d, first.Length);
        Assert.Equal(180d, first.Height);
        // tucJobItems.Depth holds the width (prod job 26448453). Swapping these
        // misreports every pallet on the Pallet information section.
        Assert.Equal(100d, first.Depth);
        Assert.Equal(2.16m, first.Cubic);
        Assert.Equal("Half Pallet", first.Notes);
        Assert.Equal("T1-1", first.Barcode);
        Assert.Equal("T1-2", plan.Items[1].Barcode);
    }

    // ---- street split, notes, VanOK -----------------------------------------

    [Fact]
    public void Street_split_keeps_the_space_on_both_sides_as_the_proc_does()
    {
        Assert.Equal(("17 ", " Saleyards Road"), TruckRowCalculator.SplitStreet("17 Saleyards Road"));
        Assert.Equal(("", "Saleyards"), TruckRowCalculator.SplitStreet("Saleyards"));
    }

    [Fact]
    public void The_DG_line_goes_before_the_row_notes()
    {
        Assert.Equal("DG Class: 3 and has documentation\r\nKeep upright", TruckRowCalculator.ComposeNotes("Keep upright", 3, true));
        Assert.Equal("DG Class: 3", TruckRowCalculator.ComposeNotes(null, 3, false));
        Assert.Equal("Keep upright", TruckRowCalculator.ComposeNotes("Keep upright", 0, false));
    }

    [Fact]
    public void Row_notes_stay_in_job_notes_and_the_delivery_note_not_client_notes()
    {
        // Decision 5.
        var row = Finalized(Row(j => j.Notes = "  Call on arrival "));
        Assert.Equal("  Call on arrival ", row.ucjbNotes);
        Assert.Equal("Call on arrival", row.DeliveryNote);
        Assert.DoesNotContain(BulkTruckBatchSql.JobColumns, c => c.Name == "ClientNotes");
        Assert.DoesNotContain(BulkTruckBatchSql.JobConstants, c => c.Name == "ClientNotes");
    }

    [Fact]
    public void VanOK_copies_the_function_so_a_real_pallet_is_never_van_ok()
    {
        Assert.False(TruckRowCalculator.IsVanOk(1, 200, 120, 100, 90, false, false));
        Assert.True(TruckRowCalculator.IsVanOk(1, 200, 1.2m, 1m, 1.2m, false, false));
    }

    // ---- rate outcome (decisions 1, 3, 4) -----------------------------------

    [Fact]
    public void Amount_is_the_rate_plus_fuel_and_is_not_rated_manually()
    {
        var row = Finalized(Row());
        Assert.Equal(44.4944m, row.ucjbAmount);
        Assert.False(row.RatedManually);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(null)]
    public void A_zero_or_missing_rate_is_rejected_and_never_inserted_at_zero(int? rate)
    {
        var error = FinalizeError(Row(), Pre(p => p.Rate = rate));
        Assert.Contains("No truck rate", error);
        Assert.Contains("not imported", error);
    }

    [Fact]
    public void A_staff_amount_is_used_and_marked_rated_manually_even_with_no_rate()
    {
        var row = Finalized(Row(j => j.Amount = 123.45m), Pre(p => { p.Rate = 0; p.Fuel = null; }));
        Assert.Equal(123.45m, row.ucjbAmount);
        Assert.True(row.RatedManually);
    }

    [Fact]
    public void A_zero_amount_on_the_row_counts_as_no_amount()
    {
        Assert.False(Finalized(Row(j => j.Amount = 0)).RatedManually);
        FinalizeError(Row(j => j.Amount = 0), Pre(p => p.Rate = 0));
    }

    [Fact]
    public void Cross_region_is_rejected_with_a_clear_message()
    {
        var error = FinalizeError(Row(), Pre(p => p.IsLocal = false));
        Assert.Contains("different regions", error);
    }

    [Fact]
    public void A_job_number_that_already_exists_fails_its_own_row()
    {
        Assert.Contains("already exists", FinalizeError(Row(), Pre(p => p.JobNumberExists = true)));
    }

    [Fact]
    public void An_after_hours_stop_rejects_with_the_sites_message()
    {
        Assert.Equal("Closed today", FinalizeError(Row(), Pre(p => { p.CanBook = false; p.OutOfHoursMessage = "Closed today"; })));
    }

    // ---- job row -------------------------------------------------------------

    [Fact]
    public void The_job_row_carries_the_truck_values_the_booking_path_writes()
    {
        var row = Finalized(Row());
        Assert.Equal(4, row.ucjbSize);
        Assert.Equal(1, row.ucjbType);
        Assert.Equal(3, row.ucjbChargeType);
        Assert.Equal(new DateTime(2031, 3, 4), row.ucjbDate);
        Assert.Equal(new DateTime(1899, 12, 30, 9, 30, 0), row.ucjbTime);
        Assert.Equal(Book, row.RequiredDeliveryTime);
        Assert.Equal("From Co, 17 Saleyards Road", row.ucjbFromAddr);
        Assert.Equal("17 ", row.PickupAddressLine3);
        Assert.Equal(" Saleyards Road", row.PickupAddressLine4);
        Assert.Equal(126, row.ucjbOpID);
        Assert.Contains(BulkTruckBatchSql.JobConstants, c => c == ("Truck", "1"));
        Assert.Contains(BulkTruckBatchSql.JobConstants, c => c == ("SourceID", "3"));
        Assert.Contains(BulkTruckBatchSql.JobConstants, c => c == ("ucjbAttention", "1"));
    }

    [Fact]
    public void Dangerous_goods_writes_the_bit_on_the_job_and_the_class_on_the_items()
    {
        var job = Row(j => j.DgClass = 3);
        Assert.All(Plan(job).Items, i => Assert.Equal(3, i.DGClass));
        Assert.Equal(1, Finalized(job).DGClass);
    }

    [Theory]
    [InlineData(null, null, false, false, 0)]
    [InlineData(9, null, false, false, 1)]
    [InlineData(null, 5.0, false, false, 75)]
    [InlineData(9, null, true, false, 6)]
    [InlineData(9, null, false, true, 100)]
    public void Status_follows_the_truck_proc_order(int? courier, double? afterHours, bool completed, bool onHold, int expected) =>
        Assert.Equal(expected, TruckRowCalculator.ResolveStatus(courier, (decimal?)afterHours, null, completed, onHold));

    // ---- SQL text --------------------------------------------------------------

    [Fact]
    public void Every_job_and_item_column_has_a_json_property_of_the_same_name()
    {
        // OPENJSON matches names case-sensitively and returns NULL on a miss, so
        // a typo here would silently insert NULL rather than fail.
        var jobProps = typeof(TruckInsertRow).GetProperties().Select(p => p.Name).ToHashSet();
        Assert.All(BulkTruckBatchSql.JobColumns, c => Assert.Contains(c.Name, jobProps));

        var itemProps = typeof(TruckItemRow).GetProperties().Select(p => p.Name).ToHashSet();
        foreach (var name in new[] { "JobNumber", "ItemId", "Items", "Weight", "Length", "Height", "Depth", "PU", "DO", "DGClass", "Notes", "Cubic", "Barcode" })
            Assert.Contains(name, itemProps);
    }

    [Fact]
    public void No_price_breakdown_rows_are_written()
    {
        // Decision 7: TR_PricingBreakdown_tucJob_Sync would overwrite ucjbAmount.
        Assert.DoesNotContain("PricingBreakdown", BulkTruckBatchSql.InsertSql);
    }

    [Fact]
    public void Inserted_ids_come_from_output_into_because_the_table_has_triggers()
    {
        Assert.Contains("OUTPUT inserted.ucjbID, inserted.ucjbNumber INTO @ids", BulkTruckBatchSql.InsertSql);
    }

    [Fact]
    public void Job_json_dates_fit_a_datetime_column()
    {
        using var doc = JsonDocument.Parse(BulkTruckBatchSql.BuildJobsJson(new[] { Finalized(Row()) }));
        Assert.Equal("2031-03-04T00:00:00.000", doc.RootElement[0].GetProperty("ucjbDate").GetString());
    }

    [Fact]
    public void The_result_json_maps_numbers_to_ids()
    {
        var ids = BulkTruckBatchSql.ParseResult("""[{"JobId":7,"JobNumber":"T1"}]""");
        Assert.Equal(7, ids["T1"]);
        Assert.Empty(BulkTruckBatchSql.ParseResult(null));
    }
}
