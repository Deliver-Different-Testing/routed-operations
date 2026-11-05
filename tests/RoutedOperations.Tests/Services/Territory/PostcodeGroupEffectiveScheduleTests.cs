using System.Data.Common;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// The schedule collapse moves a converted schedule's PostcodeGroupId and
/// PickupPostcodeGroupId onto tblBulkRunScheduleDetail and sets the day-row
/// copies to NULL. Reading the day table directly therefore loses a schedule
/// the moment it converts: on local NZ, converting 1,702 schedules took the
/// Zones screen from 1,391 schedule-to-group links to 285, and an operator
/// reading a group as unused may go on to change or delete it.
///
/// These run on SQLite, not InMemory, because the rule under test is a join.
/// InMemory treats the view entity as an unrelated store, so seeding a day row
/// and a detail row there proves nothing about how they combine.
/// </summary>
public class PostcodeGroupEffectiveScheduleTests : IDisposable
{
    private const int GroupA = 7;
    private const int GroupB = 8;

    private readonly DbContextOptions<DespatchContext> _options;
    private readonly DbConnection _connection;

    public PostcodeGroupEffectiveScheduleTests()
    {
        (_options, _connection) = CockpitTestHarness.NewSqliteOptions();
        using var db = new DynamicDespatchDbContext(_options);
        // The harness view is a bare SELECT * over the day table. This one
        // repeats the parts of 20261009177000 the Zones screen depends on: the
        // COALESCE, detail first, and the weekday mask. It is a copy of the
        // rule, kept honest by comparing it with the real view on local NZ.
        db.Database.ExecuteSqlRaw("DROP VIEW tblBulkRunSchedule;");
        db.Database.ExecuteSqlRaw("""
            CREATE VIEW tblBulkRunSchedule AS
            SELECT d.BulkRunScheduleId, d.ScheduleId, d.DayOfWeek,
                   h.Name AS Name,
                   COALESCE(x.PostcodeGroupId, d.PostcodeGroupId) AS PostcodeGroupId,
                   COALESCE(x.PickupPostcodeGroupId, d.PickupPostcodeGroupId) AS PickupPostcodeGroupId
            FROM tblBulkRunScheduleDay d
            INNER JOIN tblBulkRunScheduleHeader h ON h.ScheduleId = d.ScheduleId
            LEFT JOIN tblBulkRunScheduleDetail x ON x.ScheduleId = d.ScheduleId
            WHERE x.ScheduleId IS NULL
               OR SUBSTR(x.WeekDays, d.DayOfWeek, 1) = '1';
            """);
        db.BulkZonePostcodeGroups.AddRange(
            new BulkZonePostcodeGroup { Id = GroupA, Name = "Group A" },
            new BulkZonePostcodeGroup { Id = GroupB, Name = "Group B" });
        db.SaveChanges();
    }

    public void Dispose() => _connection.Dispose();

    private TerritoryService Svc()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>
            {
                new("CountryCode", "NZ"),
                new("CurrentTenantID", "1"),
            })),
        };
        accessor.HttpContext.Returns(ctx);
        return new TerritoryService(CockpitTestHarness.Factory(_options), accessor);
    }

    private void SeedOldShape(int scheduleId, int? delivery, int? pickup, params short[] days)
    {
        using var db = new DynamicDespatchDbContext(_options);
        db.BulkRunScheduleHeaders.Add(Header(scheduleId));
        foreach (var day in days)
            db.TblBulkRunScheduleDays.Add(new TblBulkRunScheduleDay
            {
                ScheduleId = scheduleId,
                DayOfWeek = day,
                Name = $"S{scheduleId}",
                PostcodeGroupId = delivery,
                PickupPostcodeGroupId = pickup,
            });
        db.SaveChanges();
    }

    /// <summary>A converted schedule: a key row per day, the payload on one
    /// detail row. <paramref name="keyRowDays"/> can include days the mask has
    /// switched off, because key rows are never deleted.</summary>
    private void SeedConverted(
        int scheduleId, string weekDays, int? delivery, int? pickup, params short[] keyRowDays)
    {
        using var db = new DynamicDespatchDbContext(_options);
        db.BulkRunScheduleHeaders.Add(Header(scheduleId));
        foreach (var day in keyRowDays)
            db.TblBulkRunScheduleDays.Add(new TblBulkRunScheduleDay
            {
                ScheduleId = scheduleId,
                DayOfWeek = day,
                Name = $"S{scheduleId}",
            });
        db.BulkRunScheduleDetails.Add(new BulkRunScheduleDetail
        {
            ScheduleId = scheduleId,
            WeekDays = weekDays,
            CutoffDayUnit = "W",
            OccurrencesAhead = 1,
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "test",
            PostcodeGroupId = delivery,
            PickupPostcodeGroupId = pickup,
        });
        db.SaveChanges();
    }

    private static BulkRunScheduleHeader Header(int scheduleId) => new()
    {
        ScheduleId = scheduleId,
        Name = $"Schedule {scheduleId}",
        CreatedUtc = DateTime.UtcNow,
        CreatedBy = "test",
        OriginType = "depot",
    };

    private async Task<(int Delivery, int Pickup)> CountsFor(int groupId)
    {
        var row = (await Svc().GetPostcodeGroupsAsync()).Single(g => g.Id == groupId);
        return (row.DeliveryScheduleCount, row.PickupScheduleCount);
    }

    [Fact]
    public async Task An_unconverted_schedule_still_counts_from_its_day_rows()
    {
        // Most schedules stay in the old shape until touched, and a schedule
        // that refuses to convert stays there for good.
        SeedOldShape(1, delivery: GroupA, pickup: GroupB, 1, 2, 3);

        Assert.Equal((1, 0), await CountsFor(GroupA));
        Assert.Equal((0, 1), await CountsFor(GroupB));

        var schedule = Assert.Single((await Svc().GetPostcodeGroupDetailAsync(GroupA)).Schedules);
        Assert.True(schedule.UsedForDelivery);
        Assert.False(schedule.UsedForPickup);
        Assert.Equal(3, schedule.DayCount);
    }

    [Fact]
    public async Task A_converted_schedule_counts_from_its_detail_row()
    {
        // The regression itself: every day column is NULL here, so a read of
        // the day table reports this group as having no schedules.
        SeedConverted(2, "1111100", delivery: GroupA, pickup: null, 1, 2, 3, 4, 5);

        Assert.Equal((1, 0), await CountsFor(GroupA));

        var schedule = Assert.Single((await Svc().GetPostcodeGroupDetailAsync(GroupA)).Schedules);
        Assert.Equal(2, schedule.ScheduleId);
        Assert.Equal("Schedule 2", schedule.Name);
        Assert.True(schedule.UsedForDelivery);
        Assert.False(schedule.UsedForPickup);
        Assert.Equal(5, schedule.DayCount);
    }

    [Fact]
    public async Task A_converted_schedule_counts_on_the_pickup_side()
    {
        SeedConverted(3, "1111100", delivery: null, pickup: GroupB, 1, 2, 3, 4, 5);

        Assert.Equal((0, 1), await CountsFor(GroupB));

        var schedule = Assert.Single((await Svc().GetPostcodeGroupDetailAsync(GroupB)).Schedules);
        Assert.False(schedule.UsedForDelivery);
        Assert.True(schedule.UsedForPickup);
    }

    [Fact]
    public async Task A_masked_day_is_not_in_the_day_count()
    {
        // Un-ticking a weekday clears its mask bit and keeps its key row,
        // because other tables hold that row's id. Five rows, three running.
        SeedConverted(4, "1110000", delivery: GroupA, pickup: null, 1, 2, 3, 4, 5);

        var schedule = Assert.Single((await Svc().GetPostcodeGroupDetailAsync(GroupA)).Schedules);
        Assert.Equal(3, schedule.DayCount);
        Assert.Equal((1, 0), await CountsFor(GroupA));
    }

    [Fact]
    public async Task A_mixed_set_counts_each_schedule_once_under_its_own_group()
    {
        // The state every tenant is in during the rollout. The first schedule
        // has more day rows than the others so a row count cannot pass.
        SeedOldShape(10, delivery: GroupA, pickup: null, 1, 2, 3, 4);
        SeedConverted(11, "1111100", delivery: GroupA, pickup: GroupB, 1, 2, 3, 4, 5);
        SeedConverted(12, "0000011", delivery: GroupB, pickup: GroupA, 6, 7);

        Assert.Equal((2, 1), await CountsFor(GroupA));
        Assert.Equal((1, 1), await CountsFor(GroupB));

        var detail = await Svc().GetPostcodeGroupDetailAsync(GroupA);
        Assert.Equal(new[] { 10, 11, 12 }, detail.Schedules.Select(s => s.ScheduleId).OrderBy(id => id));
        Assert.Equal(4, detail.Schedules.Single(s => s.ScheduleId == 10).DayCount);
        Assert.True(detail.Schedules.Single(s => s.ScheduleId == 12).UsedForPickup);
        Assert.False(detail.Schedules.Single(s => s.ScheduleId == 12).UsedForDelivery);
    }

    [Fact]
    public async Task A_detail_value_beats_a_stale_day_row_value()
    {
        // Conversion clears the day rows, so this should not occur, but the
        // view reads the detail row first and this screen has to agree with
        // what booking sees through that same view.
        SeedConverted(20, "1000000", delivery: GroupA, pickup: null, 1);
        using (var db = new DynamicDespatchDbContext(_options))
        {
            var row = await db.TblBulkRunScheduleDays.SingleAsync(d => d.ScheduleId == 20);
            row.PostcodeGroupId = GroupB;
            await db.SaveChangesAsync();
        }

        Assert.Equal((1, 0), await CountsFor(GroupA));
        Assert.Equal((0, 0), await CountsFor(GroupB));
    }

    [Fact]
    public async Task A_retired_schedule_is_still_counted()
    {
        // Retired headers have always been counted here. Whether they should
        // be is a separate decision; this fix is not the place to change it.
        SeedConverted(30, "1000000", delivery: GroupA, pickup: null, 1);
        SeedOldShape(31, delivery: GroupA, pickup: null, 1);
        using (var db = new DynamicDespatchDbContext(_options))
        {
            await db.BulkRunScheduleHeaders
                .Where(h => h.ScheduleId == 30 || h.ScheduleId == 31)
                .ExecuteUpdateAsync(u => u.SetProperty(h => h.RetiredUtc, DateTime.UtcNow));
        }

        Assert.Equal((2, 0), await CountsFor(GroupA));
    }
}
