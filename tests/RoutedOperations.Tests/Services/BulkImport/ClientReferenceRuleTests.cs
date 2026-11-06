// Why these exist: NZ non-truck rows book through INT_stpJob_BulkInsert, which checks
// no reference, so this rule is the only thing between a bad row and a live job. The
// wording is pinned to WS_stpJob_Insert 748-793 and DD_stpJob_InsertExcelerator 431-475:
// the same refusal has to read the same on the booking page and in a bulk file.
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

public class ClientReferenceRuleTests
{
    private static TruckClientFacts Client(bool aMandatory = false, string? aMessage = null, bool bMandatory = false, string? bMessage = null) =>
        new(5, "ACME", null, false, aMandatory, aMessage, bMandatory, bMessage);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("     ")]
    public void A_mandatory_reference_that_LEN_reads_as_empty_is_refused(string? value)
    {
        Assert.Equal("Require \"Reference A\" - \"cat\"",
            ClientReferenceRule.MandatoryRefusal(Client(aMandatory: true, aMessage: "cat"), value, "B"));
    }

    [Theory]
    [InlineData("PO1")]
    [InlineData("PO1   ")]
    [InlineData("  PO1")]
    // LEN() only ignores trailing spaces, so the proc books a tab. So must this.
    [InlineData("\t")]
    public void A_mandatory_reference_with_a_value_passes(string value)
    {
        Assert.Null(ClientReferenceRule.MandatoryRefusal(Client(aMandatory: true, aMessage: "cat"), value, null));
    }

    [Fact]
    public void A_null_message_prints_empty_quotes_exactly_as_the_proc_does()
    {
        // ISNULL(@ClientReferenceAMessage, ''). This used to print empty brackets.
        Assert.Equal("Require \"Reference A\" - \"\"", ClientReferenceRule.MandatoryRefusal(Client(aMandatory: true), "", "B"));
        Assert.Equal("Require \"Reference B\" - \"\"", ClientReferenceRule.MandatoryRefusal(Client(bMandatory: true), "A", " "));
    }

    [Fact]
    public void An_optional_reference_passes_blank_when_the_client_has_no_list()
    {
        Assert.Null(ClientReferenceRule.Refusal(Client(), "", null, aInList: true, bInList: true));
    }

    [Fact]
    public void A_value_outside_the_list_is_refused_with_the_value_printed()
    {
        Assert.Equal("\"Reference A\" - \"NOPE\" not in defined list.",
            ClientReferenceRule.Refusal(Client(), "NOPE", null, aInList: false, bInList: true));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void A_blank_optional_reference_on_a_list_client_is_refused(string? value)
    {
        // The proc's list check does not look at Mandatory, and blank matches nothing.
        Assert.Equal("\"Reference B\" - \"\" not in defined list.",
            ClientReferenceRule.Refusal(Client(), "A", value, aInList: true, bInList: false));
    }

    [Fact]
    public void Mandatory_and_list_both_report_on_a_blank_list_client_in_proc_order()
    {
        Assert.Equal("Require \"Reference A\" - \"cat\"\r\n\"Reference A\" - \"\" not in defined list.",
            ClientReferenceRule.Refusal(Client(aMandatory: true, aMessage: "cat"), "", "B", aInList: false, bInList: true));
    }

    [Fact]
    public void A_and_B_are_reported_together_joined_as_the_proc_joins_them()
    {
        Assert.Equal("Require \"Reference A\" - \"cat\"\r\n\"Reference B\" - \"X\" not in defined list.",
            ClientReferenceRule.Refusal(Client(aMandatory: true, aMessage: "cat"), " ", "X", aInList: true, bInList: false));
    }

    // ---- the truck path uses the same rule -----------------------------------------

    private static TruckRowInput Truck(string? refA, string? refB = null) => new()
    {
        Job = new BulkImportJobCreateDto
        {
            JobNumber = "T1", FromContact = "Sender", FromAddress = "1 From St", FromSuburb = "Otahuhu",
            ToAddress = "2 To St", ToSuburb = "Otahuhu", Quantity = 1, Weight = 100, ClientRefA = refA, ClientRefB = refB,
        },
        ClientId = 5,
        SpeedId = 52,
        BookDateTime = new DateTime(2031, 3, 4, 9, 30, 0),
    };

    [Fact]
    public void A_truck_row_gets_the_proc_wording_not_empty_brackets()
    {
        var result = TruckRowCalculator.Prepare(Truck(""), Client(aMandatory: true));
        Assert.Null(result.Plan);
        Assert.Equal("Require \"Reference A\" - \"\"", result.Error);
    }

    [Fact]
    public void A_truck_row_outside_the_list_gets_the_proc_wording_for_both_references()
    {
        var plan = TruckRowCalculator.Prepare(Truck("NOPE", "NADA"), Client()).Plan!;
        var pre = new TruckPreflightRow { IsLocal = true, EffectiveSpeedId = 52, Rate = 10, Fuel = 1, ReferenceAInList = false, ReferenceBInList = false };

        var result = TruckRowCalculator.Finalize(plan, pre, Client());

        Assert.Null(result.Row);
        Assert.Equal("\"Reference A\" - \"NOPE\" not in defined list.\r\n\"Reference B\" - \"NADA\" not in defined list.", result.Error);
    }

    // ---- Book a Pickup -------------------------------------------------------------

    private const string Refused = "Require \"Reference A\" - \"cat\"";

    public static TheoryData<object?> NoJobId() => new() { null, DBNull.Value, 0 };

    [Theory]
    [MemberData(nameof(NoJobId))]
    public void A_pickup_the_proc_refused_is_a_failure_with_its_message(object? jobId)
    {
        var response = new PickupJobResponse(Guid.NewGuid());

        Assert.False(BulkImportServiceV2.RecordPickupBooking(response, jobId, Refused, vehiclesRequested: 1));

        Assert.False(response.Success);
        Assert.Empty(response.JobId);
        Assert.Equal(Refused, Assert.Single(response.Messages).Message);
    }

    [Fact]
    public void A_refused_pickup_with_no_message_still_says_something()
    {
        var response = new PickupJobResponse(Guid.NewGuid());
        BulkImportServiceV2.RecordPickupBooking(response, DBNull.Value, DBNull.Value, 1);
        Assert.False(response.Success);
        Assert.Equal("Stored procedure returned a failure status with no error message.", Assert.Single(response.Messages).Message);
    }

    [Fact]
    public void A_booked_pickup_is_a_success_with_its_job_id()
    {
        var response = new PickupJobResponse(Guid.NewGuid());
        Assert.True(BulkImportServiceV2.RecordPickupBooking(response, 900, DBNull.Value, 1));
        Assert.True(response.Success);
        Assert.Equal(900, Assert.Single(response.JobId));
        Assert.Empty(response.Messages);
    }

    [Fact]
    public void A_partly_booked_pickup_stays_a_success_so_it_is_not_booked_again_and_names_the_shortfall()
    {
        var response = new PickupJobResponse(Guid.NewGuid());
        BulkImportServiceV2.RecordPickupBooking(response, 900, null, 3);

        Assert.False(BulkImportServiceV2.RecordPickupBooking(response, DBNull.Value, Refused, 3));

        Assert.True(response.Success);
        Assert.Equal(900, Assert.Single(response.JobId));
        Assert.Equal($"Only 1 of 3 vehicles were booked: {Refused}", response.Messages[0].Message);
    }
}
