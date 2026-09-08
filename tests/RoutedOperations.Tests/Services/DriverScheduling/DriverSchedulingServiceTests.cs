// xUnit tests for the DriverSchedulingService port. Uses the shared
// InMemory harness (CockpitTestHarness) + NSubstitute stubs for the
// IHttpContextAccessor / IPhoneNormaliser / IHubUrlProvider deps so
// the tests focus on schedule-lifecycle rules, not DI wiring.
//
// The DB-trigger-driven "Time Slot has already been filled." rule
// can't be exercised under InMemory (no real trigger runs); a
// dedicated integration test needs a live SQL instance and is left
// as a follow-up.

using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.DriverScheduling;
using RoutedOperations.Core.Application.Services.DriverScheduling;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.DriverScheduling;

public class DriverSchedulingServiceTests
{
    private static DriverSchedulingService NewSvc(
        Microsoft.EntityFrameworkCore.DbContextOptions<Core.Domain.DespatchContext> opts,
        string countryCode = "NZ",
        string? hubUrl = "https://hub.urgent.deliverdifferent.com/")
    {
        var http = Substitute.For<IHttpContextAccessor>();
        // AuthContext claim shape - CountryCode drives the phone
        // normaliser, DriverHubUrl drives the hub-url provider. Both
        // stubbed here so the service composes without a real request.
        var ctx = new DefaultHttpContext();
        var identity = new System.Security.Claims.ClaimsIdentity(new[]
        {
            new System.Security.Claims.Claim("CountryCode", countryCode),
            new System.Security.Claims.Claim("DriverHubUrl", hubUrl ?? string.Empty),
            new System.Security.Claims.Claim("TimeZone", "Pacific/Auckland"),
        }, "test");
        ctx.User = new System.Security.Claims.ClaimsPrincipal(identity);
        http.HttpContext.Returns(ctx);

        var phone = new PhoneNormaliser(http);
        var hub = new HubUrlProvider(http);
        return new DriverSchedulingService(CockpitTestHarness.Factory(opts), http, phone, hub);
    }

    private static async Task SeedLocation(
        Microsoft.EntityFrameworkCore.DbContextOptions<Core.Domain.DespatchContext> opts,
        int regionId = 1, string name = "Auckland")
    {
        await using var ctx = new Core.Domain.DynamicDespatchDbContext(opts);
        ctx.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = regionId, Name = name });
        await ctx.SaveChangesAsync();
    }

    // ─── CreateAsync ──────────────────────────────────────────────

    [Fact]
    public async Task CreateAsync_rejects_unknown_location()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);
        var svc = NewSvc(opts);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CreateAsync(new SchedulesCreateRequest
            {
                Schedules = new()
                {
                    new SchedulesCreateItem
                    {
                        BookDate = DateTime.Today.AddDays(1),
                        Location = "NotARealDepot",
                        Name = "Morning",
                        StartTime = new TimeSpan(8, 0, 0),
                        EndTime = new TimeSpan(17, 0, 0),
                        Wanted = 3,
                    },
                },
            }));

        Assert.Contains("Unknown location", ex.Message);
    }

    [Fact]
    public async Task CreateAsync_rejects_duplicate_book_date_location_name()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);

        // Seed an existing schedule that will clash.
        await using (var ctx = new Core.Domain.DynamicDespatchDbContext(opts))
        {
            ctx.CourierSchedules.Add(new CourierSchedule
            {
                Created = DateTime.UtcNow,
                BookDate = DateTime.Today.AddDays(1),
                Name = "Morning",
                LocationId = 1,
                StartTime = new TimeOnly(8, 0),
                EndTime = new TimeOnly(17, 0),
                Wanted = 3,
            });
            await ctx.SaveChangesAsync();
        }

        var svc = NewSvc(opts);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CreateAsync(new SchedulesCreateRequest
            {
                Schedules = new()
                {
                    new SchedulesCreateItem
                    {
                        BookDate = DateTime.Today.AddDays(1),
                        Location = "Auckland",
                        Name = "Morning",
                        StartTime = new TimeSpan(8, 0, 0),
                        EndTime = new TimeSpan(17, 0, 0),
                        Wanted = 3,
                    },
                },
            }));

        Assert.Contains("already exists", ex.Message);
    }

    // ─── DeleteAsync ──────────────────────────────────────────────

    [Fact]
    public async Task DeleteAsync_blocks_when_notification_sent()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);
        long id;
        await using (var ctx = new Core.Domain.DynamicDespatchDbContext(opts))
        {
            var s = new CourierSchedule
            {
                Created = DateTime.UtcNow,
                BookDate = DateTime.Today.AddDays(1),
                Name = "Morning",
                LocationId = 1,
                StartTime = new TimeOnly(8, 0),
                EndTime = new TimeOnly(17, 0),
                Wanted = 3,
                NotificationSent = DateTime.UtcNow,
            };
            ctx.CourierSchedules.Add(s);
            await ctx.SaveChangesAsync();
            id = s.Id;
        }
        var svc = NewSvc(opts);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.DeleteAsync(id));
        Assert.Contains("notification has been sent", ex.Message);
    }

    [Fact]
    public async Task DeleteAsync_removes_when_not_notified()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);
        long id;
        await using (var ctx = new Core.Domain.DynamicDespatchDbContext(opts))
        {
            var s = new CourierSchedule
            {
                Created = DateTime.UtcNow,
                BookDate = DateTime.Today.AddDays(1),
                Name = "Morning",
                LocationId = 1,
                StartTime = new TimeOnly(8, 0),
                EndTime = new TimeOnly(17, 0),
                Wanted = 3,
            };
            ctx.CourierSchedules.Add(s);
            await ctx.SaveChangesAsync();
            id = s.Id;
        }
        var svc = NewSvc(opts);
        await svc.DeleteAsync(id);

        await using var verifyCtx = new Core.Domain.DynamicDespatchDbContext(opts);
        Assert.Null(await verifyCtx.CourierSchedules.FirstOrDefaultAsync(s => s.Id == id));
    }

    // ─── TimeSlotDeleteAsync ──────────────────────────────────────

    [Fact]
    public async Task TimeSlotDeleteAsync_blocks_when_in_the_past()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);
        long id;
        await using (var ctx = new Core.Domain.DynamicDespatchDbContext(opts))
        {
            var t = new CourierScheduleTimeSlot
            {
                Created = DateTime.UtcNow,
                BookDateTime = DateTime.Now.AddHours(-1),   // past
                LocationId = 1,
                Wanted = 2,
            };
            ctx.CourierScheduleTimeSlots.Add(t);
            await ctx.SaveChangesAsync();
            id = t.Id;
        }
        var svc = NewSvc(opts);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.TimeSlotDeleteAsync(id));
        Assert.Contains("in the past", ex.Message);
    }

    [Fact]
    public async Task TimeSlotDeleteAsync_puts_assigned_couriers_on_reserve()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);
        long slotId, responseId;
        await using (var ctx = new Core.Domain.DynamicDespatchDbContext(opts))
        {
            // Need a schedule + response so the slot has something to
            // reassign to null.
            var schedule = new CourierSchedule
            {
                Created = DateTime.UtcNow,
                BookDate = DateTime.Today.AddDays(1),
                Name = "Morning",
                LocationId = 1,
                StartTime = new TimeOnly(8, 0),
                EndTime = new TimeOnly(17, 0),
                Wanted = 3,
                NotificationSent = DateTime.UtcNow,
            };
            ctx.CourierSchedules.Add(schedule);
            var slot = new CourierScheduleTimeSlot
            {
                Created = DateTime.UtcNow,
                BookDateTime = DateTime.Now.AddDays(1),
                LocationId = 1,
                Wanted = 2,
            };
            ctx.CourierScheduleTimeSlots.Add(slot);
            await ctx.SaveChangesAsync();
            slotId = slot.Id;

            var response = new CourierScheduleResponse
            {
                ScheduleId = schedule.Id,
                CourierId = 999,
                StatusId = 1,
                Created = DateTime.UtcNow,
                Updated = DateTime.UtcNow,
                TimeSlotId = slot.Id,
            };
            ctx.CourierScheduleResponses.Add(response);
            await ctx.SaveChangesAsync();
            responseId = response.Id;
        }

        var svc = NewSvc(opts);
        await svc.TimeSlotDeleteAsync(slotId);

        await using var verifyCtx = new Core.Domain.DynamicDespatchDbContext(opts);
        Assert.Null(await verifyCtx.CourierScheduleTimeSlots.FirstOrDefaultAsync(t => t.Id == slotId));
        // The response's TimeSlotId got nulled - courier's now on reserve.
        var response2 = await verifyCtx.CourierScheduleResponses.FirstAsync(r => r.Id == responseId);
        Assert.Null(response2.TimeSlotId);
    }

    // ─── SendScheduleRemindersAsync ───────────────────────────────

    [Fact]
    public async Task SendScheduleRemindersAsync_blocks_when_schedule_not_notified()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);
        long id;
        await using (var ctx = new Core.Domain.DynamicDespatchDbContext(opts))
        {
            var s = new CourierSchedule
            {
                Created = DateTime.UtcNow,
                BookDate = DateTime.Today.AddDays(1),
                Name = "Morning",
                LocationId = 1,
                StartTime = new TimeOnly(8, 0),
                EndTime = new TimeOnly(17, 0),
                Wanted = 3,
                NotificationSent = null,
            };
            ctx.CourierSchedules.Add(s);
            await ctx.SaveChangesAsync();
            id = s.Id;
        }
        var svc = NewSvc(opts);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.SendScheduleRemindersAsync(id));
        Assert.Contains("inactive", ex.Message);
    }

    // ─── PhoneNormaliser (indirect - tenant switches SMS payload) ──

    [Fact]
    public void PhoneNormaliser_NZ_strips_plus64_and_whitespace()
    {
        var http = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(new[]
        {
            new System.Security.Claims.Claim("CountryCode", "NZ"),
        }, "test"));
        http.HttpContext.Returns(ctx);
        var norm = new PhoneNormaliser(http);

        Assert.Equal("0215551234", norm.NormaliseForSms("+64 21 555 1234"));
        Assert.Equal("0215551234", norm.NormaliseForSms("0064 21 555 1234"));
        Assert.Equal("0215551234", norm.NormaliseForSms(" 021 555 1234 "));
    }

    [Fact]
    public void PhoneNormaliser_US_strips_plus1_separators()
    {
        var http = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(new[]
        {
            new System.Security.Claims.Claim("CountryCode", "US"),
        }, "test"));
        http.HttpContext.Returns(ctx);
        var norm = new PhoneNormaliser(http);

        Assert.Equal("5555551234", norm.NormaliseForSms("+1 555-555-1234"));
        Assert.Equal("5555551234", norm.NormaliseForSms("(555) 555.1234"));
    }
}
