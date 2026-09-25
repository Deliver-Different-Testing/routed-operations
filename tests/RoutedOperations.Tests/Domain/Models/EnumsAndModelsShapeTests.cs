// Shape + round-trip tests for the pure enums and value-holder classes under
// Core/Domain/Models. These are keyless DTOs the BulkService uses to receive
// SP results (Rate, ZoneRate, UrgentRate, ZoneLinehaulRate, SuburbIDResult),
// plus in-memory item queue types (PendingBulkJobItem, LinehaulAddressDto,
// PikupAddressDto) and the Country enum + CountryExtensions helper.
using RoutedOperations.Core.Domain.Models;

namespace RoutedOperations.Tests.Domain.Models;

public class EnumsAndModelsShapeTests
{
    [Fact]
    public void Country_HasNzAndUsMembers_WithExpectedNumericValues()
    {
        Assert.Equal(1, (int)Country.Nz);
        Assert.Equal(2, (int)Country.Us);
    }

    [Theory]
    [InlineData(Country.Nz, "NZ")]
    [InlineData(Country.Us, "US")]
    public void CountryExtensions_GetDescription_ReturnsAttributeValue(Country c, string expected)
    {
        Assert.Equal(expected, c.GetDescription());
    }

    [Fact]
    public void CountryExtensions_GetDescription_ForUnknown_FallsBackToEnumName()
    {
        // Cast an out-of-range int to Country to force the fallback branch
        // where GetField returns null and the method falls back to .ToString().
        // .ToString() on an unnamed enum value returns the numeric string.
        var unknown = (Country)999;
        var result = unknown.GetDescription();
        Assert.Equal("999", result);
    }

    [Fact]
    public void Rate_Defaults_AreNull()
    {
        var r = new Rate();
        Assert.Null(r.rate);
    }

    [Fact]
    public void Rate_RoundTrips_DecimalValue()
    {
        var r = new Rate { rate = 12.34m };
        Assert.Equal(12.34m, r.rate);
    }

    [Fact]
    public void ZoneRate_Defaults_AreNull()
    {
        var r = new ZoneRate();
        Assert.Null(r.Rate);
    }

    [Fact]
    public void ZoneRate_RoundTrips_DecimalValue()
    {
        var r = new ZoneRate { Rate = 5.5m };
        Assert.Equal(5.5m, r.Rate);
    }

    [Fact]
    public void UrgentRate_Defaults()
    {
        var r = new UrgentRate();
        Assert.Equal(0, r.JobTypeID);
        Assert.Null(r.Name);
        Assert.Null(r.Speed);
        Assert.Equal(0m, r.Rate);
        Assert.Null(r.Availability);
        Assert.Null(r.BookDate);
    }

    [Fact]
    public void UrgentRate_RoundTrips_AllProperties()
    {
        var when = new DateTime(2026, 8, 13);
        var r = new UrgentRate
        {
            JobTypeID = 42,
            Name = "Same-day",
            Speed = "1H",
            Rate = 89.50m,
            Availability = "Business hours",
            BookDate = when,
        };
        Assert.Equal(42, r.JobTypeID);
        Assert.Equal("Same-day", r.Name);
        Assert.Equal("1H", r.Speed);
        Assert.Equal(89.50m, r.Rate);
        Assert.Equal("Business hours", r.Availability);
        Assert.Equal(when, r.BookDate);
    }

    [Fact]
    public void ZoneLinehaulRate_Defaults_AllNullable()
    {
        var r = new ZoneLinehaulRate();
        Assert.Equal(0, r.BulkRunScheduleId);
        Assert.Null(r.ZoneBaseAmount);
        Assert.Null(r.PickupAmount);
        Assert.Null(r.PickupBaseAmount);
        Assert.Null(r.PickupAddtionItemAmount);
        Assert.Null(r.LinehaulSumAmount);
        Assert.Null(r.ZoneAmount);
        Assert.Null(r.ZoneAddtionItemAmount);
        Assert.Null(r.TotalAmount);
        Assert.Null(r.Description);
    }

    [Fact]
    public void ZoneLinehaulRate_RoundTrips_AllProperties()
    {
        var r = new ZoneLinehaulRate
        {
            BulkRunScheduleId = 7,
            ZoneBaseAmount = 1m,
            PickupAmount = 2m,
            PickupBaseAmount = 3m,
            PickupAddtionItemAmount = 4m,
            LinehaulSumAmount = 5m,
            ZoneAmount = 6m,
            ZoneAddtionItemAmount = 7m,
            TotalAmount = 8m,
            Description = "leg",
        };
        Assert.Equal(7, r.BulkRunScheduleId);
        Assert.Equal(1m, r.ZoneBaseAmount);
        Assert.Equal(2m, r.PickupAmount);
        Assert.Equal(3m, r.PickupBaseAmount);
        Assert.Equal(4m, r.PickupAddtionItemAmount);
        Assert.Equal(5m, r.LinehaulSumAmount);
        Assert.Equal(6m, r.ZoneAmount);
        Assert.Equal(7m, r.ZoneAddtionItemAmount);
        Assert.Equal(8m, r.TotalAmount);
        Assert.Equal("leg", r.Description);
    }

    [Fact]
    public void PendingBulkJobItem_Defaults()
    {
        var p = new PendingBulkJobItem();
        Assert.Null(p.ParentJobNumber);
        Assert.Equal(0, p.ItemId);
        Assert.Equal(1, p.Items); // default set inline
        Assert.Null(p.Weight);
        Assert.Null(p.Length);
        Assert.Null(p.Height);
        Assert.Null(p.Depth);
        Assert.Null(p.Cubic);
        Assert.Null(p.Notes);
        Assert.Null(p.Barcode);
    }

    [Fact]
    public void PendingBulkJobItem_RoundTrips_AllProperties()
    {
        var p = new PendingBulkJobItem
        {
            ParentJobNumber = "PJ-1",
            ItemId = 3,
            Items = 4,
            Weight = 12.5,
            Length = 30,
            Height = 20,
            Depth = 10,
            Cubic = 0.006m,
            Notes = "handle with care",
            Barcode = "BC001",
        };
        Assert.Equal("PJ-1", p.ParentJobNumber);
        Assert.Equal(3, p.ItemId);
        Assert.Equal(4, p.Items);
        Assert.Equal(12.5, p.Weight);
        Assert.Equal(30, p.Length);
        Assert.Equal(20, p.Height);
        Assert.Equal(10, p.Depth);
        Assert.Equal(0.006m, p.Cubic);
        Assert.Equal("handle with care", p.Notes);
        Assert.Equal("BC001", p.Barcode);
    }

    [Fact]
    public void LinehaulAddressDto_Defaults_AndRoundTrip()
    {
        var a = new LinehaulAddressDto();
        Assert.Null(a.Company);
        Assert.Null(a.Address);
        Assert.Null(a.Suburb);
        Assert.Equal(0, a.SuburbID);
        Assert.Equal(0, a.PostCode);
        Assert.Null(a.PickUpLatitude);
        Assert.Null(a.PickUpLongitude);

        a.Company = "Acme";
        a.Address = "1 Way";
        a.Suburb = "CBD";
        a.SuburbID = 5;
        a.PostCode = 6011;
        a.PickUpLatitude = -41.29m;
        a.PickUpLongitude = 174.78m;
        Assert.Equal("Acme", a.Company);
        Assert.Equal("1 Way", a.Address);
        Assert.Equal("CBD", a.Suburb);
        Assert.Equal(5, a.SuburbID);
        Assert.Equal(6011, a.PostCode);
        Assert.Equal(-41.29m, a.PickUpLatitude);
        Assert.Equal(174.78m, a.PickUpLongitude);
    }

    [Fact]
    public void PikupAddressDto_InheritsAndInstantiates()
    {
        var p = new PikupAddressDto { Company = "Pickup Co", PostCode = 1234 };
        Assert.IsAssignableFrom<LinehaulAddressDto>(p);
        Assert.Equal("Pickup Co", p.Company);
        Assert.Equal(1234, p.PostCode);
    }

    [Fact]
    public void SuburbIDResult_Defaults_AndRoundTrip()
    {
        var s = new SuburbIDResult();
        Assert.Equal(0, s.SuburbID);
        s.SuburbID = 88;
        Assert.Equal(88, s.SuburbID);
    }
}
