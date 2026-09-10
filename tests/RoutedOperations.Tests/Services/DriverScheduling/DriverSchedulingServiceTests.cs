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

    // ─── Round-2 regression guards ────────────────────────────────
    // The block below locks in the five fixes surfaced by the round-2
    // deep audit on 2026-09-10 so they can't silently unravel in a
    // future refactor.

    [Fact]
    public async Task CreateAsync_rejects_wanted_below_one()
    {
        // Regression: pre-fix, the service accepted wanted=-5 or 0 and
        // wrote a schedule that no time-slot could ever fill. Frontend
        // guards but API bypass slipped through.
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
                        Location = "Auckland",
                        Name = "Zero Wanted",
                        StartTime = new TimeSpan(8, 0, 0),
                        EndTime = new TimeSpan(17, 0, 0),
                        Wanted = 0,
                    },
                },
            }));

        Assert.Contains("at least 1", ex.Message);
    }

    [Fact]
    public async Task CreateAsync_rejects_start_time_at_or_after_end_time()
    {
        // Regression: pre-fix, the service accepted startTime>=endTime
        // and wrote a schedule with an inverted window - no slot inside
        // could ever satisfy the "TimeOfDay within Start..End" guard.
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
                        Location = "Auckland",
                        Name = "Backwards",
                        StartTime = new TimeSpan(17, 0, 0),
                        EndTime = new TimeSpan(8, 0, 0),
                        Wanted = 3,
                    },
                },
            }));

        Assert.Contains("before end time", ex.Message);
    }

    [Fact]
    public async Task TimeSlotUpdateAsync_persists_wanted()
    {
        // Regression: pre-fix, TimeSlotUpdateAsync only wrote
        // BookDateTime - request.Wanted was silently dropped even though
        // the DTO and frontend both send it. Legacy CourierManager had
        // the same oversight; the port carried it verbatim.
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);
        long slotId;
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
                Wanted = 5,
            });
            var slot = new CourierScheduleTimeSlot
            {
                Created = DateTime.UtcNow,
                BookDateTime = DateTime.Today.AddDays(1).AddHours(10),
                LocationId = 1,
                Wanted = 2,
            };
            ctx.CourierScheduleTimeSlots.Add(slot);
            await ctx.SaveChangesAsync();
            slotId = slot.Id;
        }

        var svc = NewSvc(opts);
        await svc.TimeSlotUpdateAsync(new TimeSlotUpdateRequest
        {
            Id = slotId,
            BookDateTime = DateTime.Today.AddDays(1).AddHours(11).AddMinutes(30),
            Wanted = 8,
        });

        await using var verify = new Core.Domain.DynamicDespatchDbContext(opts);
        var updated = await verify.CourierScheduleTimeSlots.FirstAsync(t => t.Id == slotId);
        Assert.Equal(8, updated.Wanted);
        Assert.Equal(DateTime.Today.AddDays(1).AddHours(11).AddMinutes(30), updated.BookDateTime);
    }

    [Fact]
    public async Task TimeSlotUpdateAsync_moves_slot_within_schedule_window()
    {
        // Regression: pre-fix, the schedule-fit check used AnyAsync with
        // TimeOnly.ToTimeSpan() inside the WHERE, which EF Core cannot
        // translate to SQL - every real DB call threw a LINQ-translation
        // error. Fix pulls candidate schedules into memory first, then
        // does the fit check in-app. InMemory won't reproduce the raw
        // translation error but this test locks in the split's
        // behavioral correctness (right slot moved, no false-positive
        // "No schedules found").
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);
        long slotId;
        await using (var ctx = new Core.Domain.DynamicDespatchDbContext(opts))
        {
            ctx.CourierSchedules.Add(new CourierSchedule
            {
                Created = DateTime.UtcNow,
                BookDate = DateTime.Today.AddDays(1),
                Name = "Window",
                LocationId = 1,
                StartTime = new TimeOnly(8, 0),
                EndTime = new TimeOnly(17, 0),
                Wanted = 3,
            });
            var slot = new CourierScheduleTimeSlot
            {
                Created = DateTime.UtcNow,
                BookDateTime = DateTime.Today.AddDays(1).AddHours(9),
                LocationId = 1,
                Wanted = 1,
            };
            ctx.CourierScheduleTimeSlots.Add(slot);
            await ctx.SaveChangesAsync();
            slotId = slot.Id;
        }

        var svc = NewSvc(opts);
        // Move slot from 09:00 to 14:00, still inside the 08-17 window.
        await svc.TimeSlotUpdateAsync(new TimeSlotUpdateRequest
        {
            Id = slotId,
            BookDateTime = DateTime.Today.AddDays(1).AddHours(14),
            Wanted = 1,
        });

        await using var verify = new Core.Domain.DynamicDespatchDbContext(opts);
        var moved = await verify.CourierScheduleTimeSlots.FirstAsync(t => t.Id == slotId);
        Assert.Equal(DateTime.Today.AddDays(1).AddHours(14), moved.BookDateTime);
    }

    [Fact]
    public async Task ScheduleResponseStatusUpdateAsync_rejects_batch_conflict_same_courier_overlap()
    {
        // Regression: pre-fix, an operator flipping (courierX, schedA)
        // and (courierX, schedB) to Available in a single call where A
        // overlaps B was silently allowed - the per-row check only saw
        // "currently Available on tenant" and neither batch peer was
        // there yet. Same courier ended up double-booked across
        // overlapping windows. Fix: include batch peers in the overlap
        // set.
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await SeedLocation(opts);
        long response1Id, response2Id;
        await using (var ctx = new Core.Domain.DynamicDespatchDbContext(opts))
        {
            // Stub courier so the service's .Include(r => r.Courier)
            // hydrates the nav prop under InMemory - avoids the
            // service short-circuiting on a null-nav Include chain.
            ctx.TucCouriers.Add(new TucCourier
            {
                UccrId = 42,
                Code = "42",
                UccrName = "Test",
                UccrSurname = "Courier",
                Active = true,
                UccrInternal = false,
                RegionId = 1,
                UccrVehicle = "Sedan",
            });

            // Schedule A: 08:00-17:00, notified
            var schedA = new CourierSchedule
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
            // Schedule B: 14:00-16:00, notified - overlaps A
            var schedB = new CourierSchedule
            {
                Created = DateTime.UtcNow,
                BookDate = DateTime.Today.AddDays(1),
                Name = "Overlap",
                LocationId = 1,
                StartTime = new TimeOnly(14, 0),
                EndTime = new TimeOnly(16, 0),
                Wanted = 2,
                NotificationSent = DateTime.UtcNow,
            };
            ctx.CourierSchedules.AddRange(schedA, schedB);
            await ctx.SaveChangesAsync();

            // Both responses for the SAME courier, both currently Unavailable
            var r1 = new CourierScheduleResponse
            {
                ScheduleId = schedA.Id,
                CourierId = 42,
                StatusId = 3,
                Created = DateTime.UtcNow,
                Updated = DateTime.UtcNow,
            };
            var r2 = new CourierScheduleResponse
            {
                ScheduleId = schedB.Id,
                CourierId = 42,
                StatusId = 3,
                Created = DateTime.UtcNow,
                Updated = DateTime.UtcNow,
            };
            ctx.CourierScheduleResponses.AddRange(r1, r2);
            await ctx.SaveChangesAsync();
            response1Id = r1.Id;
            response2Id = r2.Id;
        }

        var svc = NewSvc(opts);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.ScheduleResponseStatusUpdateAsync(new ScheduleResponseStatusUpdateRequest
            {
                Ids = new List<long> { response1Id, response2Id },
                StatusId = 1,
            }));

        Assert.Contains("Conflicting schedule", ex.Message);

        // Verify atomicity: neither response was mutated because the
        // guard fires before SaveChangesAsync.
        await using var verify = new Core.Domain.DynamicDespatchDbContext(opts);
        Assert.Equal(3, (await verify.CourierScheduleResponses.FirstAsync(r => r.Id == response1Id)).StatusId);
        Assert.Equal(3, (await verify.CourierScheduleResponses.FirstAsync(r => r.Id == response2Id)).StatusId);
    }
}
