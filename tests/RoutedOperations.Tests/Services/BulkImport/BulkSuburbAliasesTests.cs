using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Dtos.BulkImport.SuburbAlias;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.BulkImport;

// #333: a suburb fix the operator picks in Fix Suburbs is remembered for the
// client (D4: per client, with tenant-wide ClientId NULL rows as fallback) so
// the same sheet value is not asked again, and the server books the same
// suburb the wizard showed, for New Import and Staff Import alike.
public class BulkSuburbAliasesTests
{
    private const int Contact = BulkClientScopeTests.Contact;

    // ---------------- normaliser -----------------

    // The sheet and the stored alias must compare equal however the file
    // spells the suburb, or a remembered fix silently stops applying.
    [Theory]
    [InlineData("Ōtāhuhu", "otahuhu")]
    [InlineData("  Mt  Eden ", "mount eden")]
    [InlineData("MT. ALBERT", "mount albert")]
    [InlineData("Mount Eden", "mount eden")]
    [InlineData("St Heliers", "saint heliers")]
    [InlineData("Stanley Point", "stanley point")]
    // tucSuburb has 'Pt Chevalier' where sheets say 'Point Chevalier', and a
    // dot with no space ('Mt.Eden') is still an abbreviation.
    [InlineData("Pt Chevalier", "point chevalier")]
    [InlineData("Point Chevalier", "point chevalier")]
    [InlineData("PT.CHEVALIER", "point chevalier")]
    [InlineData("Mt.Eden", "mount eden")]
    [InlineData("St.Albans", "saint albans")]
    [InlineData(null, "")]
    public void Normalise_folds_case_marks_and_mt_st(string? raw, string expected) =>
        Assert.Equal(expected, BulkSuburbAliases.Normalise(raw));

    // Excel drops the leading zero of an NZ postcode ("624" for "0624").
    [Theory]
    [InlineData("624", true, "0624")]
    [InlineData(" 1011 ", true, "1011")]
    [InlineData("", true, null)]
    [InlineData(null, true, null)]
    [InlineData("02110", false, "02110")]
    public void NormalisePostCode_pads_nz_to_four(string? raw, bool isNz, string? expected) =>
        Assert.Equal(expected, BulkSuburbAliases.NormalisePostCode(raw, isNz));

    private static TblBulkSuburbAlias Row(int id, int? clientId, string suburb, string? pc, int suburbId) =>
        new() { SuburbAliasId = id, ClientId = clientId, RawSuburb = suburb, RawPostCode = pc, SuburbId = suburbId };

    // The client's own fix wins over the tenant-wide one; another client's
    // fix never applies; a postcode-specific fix beats a postcode-less one
    // only within the same owner (client before tenant).
    [Fact]
    public void Find_prefers_the_clients_row_then_the_tenant_row()
    {
        var rows = new[]
        {
            Row(1, null, "otahuhu", "0624", 20),
            Row(2, 5, "otahuhu", "0624", 10),
            Row(3, 9, "otahuhu", "0624", 30),
            Row(4, 5, "mount eden", null, 40),
            Row(5, null, "mount eden", "1024", 50),
        };
        Assert.Equal(10, BulkSuburbAliases.Find(rows, 5, "Ōtāhuhu", "624", true)?.SuburbId);
        Assert.Equal(20, BulkSuburbAliases.Find(rows, 6, "otahuhu", "0624", true)?.SuburbId);
        Assert.Equal(30, BulkSuburbAliases.Find(rows, 9, "OTAHUHU", "0624", true)?.SuburbId);
        Assert.Null(BulkSuburbAliases.Find(rows, 5, "otahuhu", "1062", true));
        Assert.Equal(40, BulkSuburbAliases.Find(rows, 5, "Mt Eden", "1024", true)?.SuburbId);
        Assert.Equal(50, BulkSuburbAliases.Find(rows, 6, "Mt Eden", "1024", true)?.SuburbId);
    }

    // ---------------- endpoints (service) -----------------

    private static BulkImportServiceV2 Svc(out DynamicDespatchDbContext seed, string clientTypeId)
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out seed, out _, countryCode: "NZ", clientTypeId: clientTypeId);
        BulkClientScopeTests.SeedClients(seed);
        seed.TucSuburbs.AddRange(
            new TucSuburb { UcsuId = 1, UcsuName = "Ponsonby", PostCode = "1011" },
            new TucSuburb { UcsuId = 2, UcsuName = "Otahuhu", PostCode = "1062" });
        seed.SaveChanges();
        return svc;
    }

    [Fact]
    public async Task Remember_stores_the_normalised_sheet_value_and_a_second_pick_replaces_it()
    {
        var svc = Svc(out var seed, "4");

        var first = await svc.RememberSuburbAlias(Contact, new RememberSuburbAliasRequest { ClientId = 100, RawSuburb = " Pōnsonby ", RawPostCode = "11", SuburbId = 2 });
        var second = await svc.RememberSuburbAlias(Contact, new RememberSuburbAliasRequest { ClientId = 100, RawSuburb = "PONSONBY", RawPostCode = "0011", SuburbId = 1 });

        Assert.True(first.Success);
        Assert.True(second.Success);
        Assert.Equal("Ponsonby", second.Alias?.SuburbName);
        var stored = Assert.Single(seed.TblBulkSuburbAliases.ToList());
        Assert.Equal((100, "ponsonby", "0011", 1), (stored.ClientId ?? 0, stored.RawSuburb, stored.RawPostCode, stored.SuburbId));
    }

    [Fact]
    public async Task Remember_refuses_an_unknown_suburb()
    {
        var svc = Svc(out var seed, "4");
        var r = await svc.RememberSuburbAlias(Contact, new RememberSuburbAliasRequest { ClientId = 100, RawSuburb = "x", SuburbId = 999 });
        Assert.False(r.Success);
        Assert.Contains(r.Messages, m => m.Message == "Invalid suburb.");
        Assert.Empty(seed.TblBulkSuburbAliases.ToList());
    }

    // Aliases are only read on NZ, so a US tenant must not write rows that
    // nothing ever uses.
    [Fact]
    public async Task Remember_is_refused_on_a_us_tenant()
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US", clientTypeId: "4");
        BulkClientScopeTests.SeedClients(seed);
        seed.TucSuburbs.Add(new TucSuburb { UcsuId = 1, UcsuName = "Ponsonby", PostCode = "1011" });
        seed.SaveChanges();

        var r = await svc.RememberSuburbAlias(Contact, new RememberSuburbAliasRequest { ClientId = 100, RawSuburb = "x", SuburbId = 1 });

        Assert.False(r.Success);
        Assert.Contains(r.Messages, m => m.Message == "This endpoint is only available for NZ tenants");
        Assert.Empty(seed.TblBulkSuburbAliases.ToList());
    }

    // Two operators remember the same sheet value at once. The second save
    // hits UX_tblBulkSuburbAlias_Client_Suburb_PostCode; the fix IS
    // remembered (by the first), so that is a success, not a 500. Any other
    // save failure still surfaces.
    private sealed class RacingContext(DbContextOptions options, bool competitorSaved) : DynamicDespatchDbContext(options)
    {
        public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
        {
            if (ChangeTracker.Entries<TblBulkSuburbAlias>().Any(e => e.State == EntityState.Added))
            {
                if (competitorSaved)
                {
                    using var other = new DynamicDespatchDbContext(options);
                    other.TblBulkSuburbAliases.Add(Row(50, 100, "ponsonbi", "1011", 2));
                    await other.SaveChangesAsync(cancellationToken);
                    // SQL Server reports the lost race as error 2601 on the unique index.
                    throw new DbUpdateException("An error occurred while saving the entity changes.",
                        RouteViewer.RouteViewerRunCourierRejectTests.MakeSqlException(2601,
                            "Cannot insert duplicate key row in object 'dbo.tblBulkSuburbAlias' with unique index 'UX_tblBulkSuburbAlias_Client_Suburb_PostCode'."));
                }
                // Anything else, e.g. a deadlock victim (1205).
                throw new DbUpdateException("An error occurred while saving the entity changes.",
                    RouteViewer.RouteViewerRunCourierRejectTests.MakeSqlException(1205,
                        "Transaction was deadlocked on lock resources with another process and has been chosen as the deadlock victim."));
            }
            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }
    }

    private static BulkImportServiceV2 RacingSvc(bool competitorSaved, out DynamicDespatchDbContext seed)
    {
        var options = BulkImportTestHarness.NewOptions();
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new RacingContext(options, competitorSaved));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult<DynamicDespatchDbContext>(new RacingContext(options, competitorSaved)));
        var accessor = BulkImportTestHarness.Accessor("NZ", "4", "UTC");
        var here = new HereGeocodeService(new HttpClient(new BulkImportServiceV2CoreTests.FakeHandler()), new AppSettings { HereMapsApiKey = string.Empty });
        var address = new AddressService(factory, accessor, here, BulkImportTestHarness.Cache(accessor), new BulkClientScope(accessor));
        var svc = new BulkImportServiceV2(factory, new NoHttpFactory(), accessor, address, new BulkClientScope(accessor),
            Substitute.For<IBulkTruckPreflight>(), Substitute.For<IBulkTruckInserter>(), Substitute.For<IBulkP2PItemInserter>());
        seed = BulkImportTestHarness.Context(options);
        BulkClientScopeTests.SeedClients(seed);
        seed.TucSuburbs.AddRange(
            new TucSuburb { UcsuId = 1, UcsuName = "Ponsonby", PostCode = "1011" },
            new TucSuburb { UcsuId = 2, UcsuName = "Otahuhu", PostCode = "1062" });
        seed.SaveChanges();
        return svc;
    }

    // The EF model carries the unique index migration 20261125140500 creates,
    // so the model and the table agree on what a duplicate is.
    [Fact]
    public void Alias_model_has_the_migrations_unique_index()
    {
        using var ctx = BulkImportTestHarness.Context(BulkImportTestHarness.NewOptions());
        var ix = Assert.Single(ctx.Model.FindEntityType(typeof(TblBulkSuburbAlias))!.GetIndexes());
        Assert.True(ix.IsUnique);
        Assert.Equal("UX_tblBulkSuburbAlias_Client_Suburb_PostCode", ix.GetDatabaseName());
        Assert.Equal(new[] { "ClientId", "RawSuburb", "RawPostCode" }, ix.Properties.Select(p => p.Name));
    }

    // ClientId and RawPostCode are nullable, so EF's SQL Server convention
    // would add WHERE [ClientId] IS NOT NULL AND [RawPostCode] IS NOT NULL.
    // The migration's index is unfiltered (tenant rows and postcode-less rows
    // are unique too), so the model must say so. Only the SQL Server provider
    // applies the convention; building the model opens no connection.
    [Fact]
    public void Alias_unique_index_is_unfiltered_like_the_migration()
    {
        var options = new DbContextOptionsBuilder<DespatchContext>()
            .UseSqlServer("Server=unused;Database=unused;Trusted_Connection=True;").Options;
        using var ctx = new DynamicDespatchDbContext(options);
        var ix = Assert.Single(ctx.Model.FindEntityType(typeof(TblBulkSuburbAlias))!.GetIndexes());
        Assert.Null(ix.GetFilter());
    }

    [Fact]
    public async Task Remember_treats_a_concurrent_save_of_the_same_key_as_success()
    {
        var svc = RacingSvc(competitorSaved: true, out var seed);

        var r = await svc.RememberSuburbAlias(Contact, new RememberSuburbAliasRequest { ClientId = 100, RawSuburb = "Ponsonbi", RawPostCode = "1011", SuburbId = 1 });

        Assert.True(r.Success);
        Assert.Equal((50, 2, "Otahuhu"), (r.Alias?.Id ?? 0, r.Alias?.SuburbId ?? 0, r.Alias?.SuburbName));
        Assert.Equal(50, Assert.Single(seed.TblBulkSuburbAliases.ToList()).SuburbAliasId);
    }

    [Fact]
    public async Task Remember_still_fails_loudly_when_the_save_fails_for_another_reason()
    {
        var svc = RacingSvc(competitorSaved: false, out _);

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            svc.RememberSuburbAlias(Contact, new RememberSuburbAliasRequest { ClientId = 100, RawSuburb = "Ponsonbi", RawPostCode = "1011", SuburbId = 1 }));
    }

    // A changed pick (Otahuhu -> Ponsonby) whose save fails on a deadlock or
    // timeout rolls the delete back, so the old row is still there. That is
    // not a concurrent win: returning it as success would tell the wizard the
    // new pick was remembered while the table still says Otahuhu.
    [Fact]
    public async Task Remember_rethrows_a_non_unique_failure_on_a_changed_pick_even_when_the_old_row_exists()
    {
        var svc = RacingSvc(competitorSaved: false, out var seed);
        seed.TblBulkSuburbAliases.Add(Row(40, 100, "ponsonbi", "1011", 2));
        seed.SaveChanges();

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            svc.RememberSuburbAlias(Contact, new RememberSuburbAliasRequest { ClientId = 100, RawSuburb = "Ponsonbi", RawPostCode = "1011", SuburbId = 1 }));
        Assert.Equal(2, Assert.Single(seed.TblBulkSuburbAliases.AsNoTracking().ToList()).SuburbId);
    }

    [Fact]
    public async Task Get_returns_the_clients_rows_first_then_tenant_rows_and_never_another_clients()
    {
        var svc = Svc(out var seed, "4");
        seed.TblBulkSuburbAliases.AddRange(
            Row(1, null, "otahuhu", "1062", 2),
            Row(2, 100, "ponsonbi", "1011", 1),
            Row(3, 200, "elsewhere", null, 1));
        seed.SaveChanges();

        var r = await svc.GetSuburbAliases(Contact, 100, Guid.NewGuid());

        Assert.True(r.Success);
        Assert.Equal(new[] { 2, 1 }, r.Aliases.Select(a => a.Id));
        Assert.Equal(new[] { "Ponsonby", "Otahuhu" }, r.Aliases.Select(a => a.SuburbName));
    }

    // A customer may only read and change fixes for clients they act for,
    // and may not clear a tenant-wide fix other clients rely on.
    [Fact]
    public async Task Customer_is_limited_to_their_own_clients()
    {
        var svc = Svc(out var seed, "2");
        seed.TblBulkSuburbAliases.AddRange(
            Row(1, null, "otahuhu", "1062", 2),
            Row(2, 100, "ponsonbi", "1011", 1),
            Row(3, 200, "elsewhere", null, 1));
        seed.SaveChanges();

        var read = await svc.GetSuburbAliases(Contact, 200, Guid.NewGuid());
        Assert.False(read.Success);
        Assert.Contains(read.Messages, m => m.Message == "Invalid client.");

        var write = await svc.RememberSuburbAlias(Contact, new RememberSuburbAliasRequest { ClientId = 200, RawSuburb = "x", SuburbId = 1 });
        Assert.False(write.Success);
        Assert.Contains(write.Messages, m => m.Message == "Invalid client.");

        foreach (var id in new[] { 1, 3 })
        {
            var refused = await svc.ForgetSuburbAlias(Contact, new IdRequest { Id = id });
            Assert.False(refused.Success);
            Assert.Contains(refused.Messages, m => m.Message == "Suburb fix not found.");
        }

        var forgot = await svc.ForgetSuburbAlias(Contact, new IdRequest { Id = 2 });
        Assert.True(forgot.Success);
        Assert.Equal(new[] { 1, 3 }, seed.TblBulkSuburbAliases.Select(a => a.SuburbAliasId).OrderBy(i => i).ToList());
    }

    // ---------------- server lookup (New Import) -----------------

    // An NZ routed import on a depot schedule (the pickup suburb comes from
    // the schedule's region), so the only thing that can stop the booking is
    // the delivery suburb. The job item proc is stubbed (InMemory cannot run
    // procs) so the import runs end to end and returns success.
    private sealed class StubProcsContext(DbContextOptions options, IDespatchContextProcedures procs)
        : DynamicDespatchDbContext(options)
    {
        public override IDespatchContextProcedures Procedures { get => procs; set { } }
    }

    private sealed class NoHttpFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new BulkImportServiceV2CoreTests.FakeHandler());
    }

    private static BulkImportServiceV2 RoutedSvc(out DynamicDespatchDbContext seed, params TucSuburb[] suburbs)
    {
        var options = BulkImportTestHarness.NewOptions();
        var procs = Substitute.For<IDespatchContextProcedures>();
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new StubProcsContext(options, procs));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult<DynamicDespatchDbContext>(new StubProcsContext(options, procs)));
        var accessor = BulkImportTestHarness.Accessor("NZ", "4", "UTC");
        var here = new HereGeocodeService(new HttpClient(new BulkImportServiceV2CoreTests.FakeHandler()), new AppSettings { HereMapsApiKey = string.Empty });
        var address = new AddressService(factory, accessor, here, BulkImportTestHarness.Cache(accessor), new BulkClientScope(accessor));
        var svc = new BulkImportServiceV2(factory, new NoHttpFactory(), accessor, address, new BulkClientScope(accessor),
            Substitute.For<IBulkTruckPreflight>(), Substitute.For<IBulkTruckInserter>(), Substitute.For<IBulkP2PItemInserter>());
        seed = BulkImportTestHarness.Context(options);
        BulkImportServiceV2JobFactoryTests.SeedMinimalClient(seed, 5, speedId: 1);
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 3, Name = "Depot", FromCompany = "Depot", FromAddress = "1 Depot Rd", FromSuburb = "Otahuhu", FromPostCode = 1062, Active = true });
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule { BulkRunScheduleId = 7, Name = "S", Region = 3, SpeedId = 1, StartTime = new TimeSpan(9, 0, 0), CutoffHours = 0 });
        seed.TucSuburbs.Add(new TucSuburb { UcsuId = 2, UcsuName = "Otahuhu", PostCode = "1062" });
        seed.TucSuburbs.AddRange(suburbs);
        return svc;
    }

    private static BulkImportRequest Routed(string toSuburb, string toPostCode) => new()
    {
        ClientId = 5,
        SpeedId = 1,
        ScheduleId = 7,
        isKmRatedJobs = true, // already rated: skip the external km rate call
        BookDate = DateTime.UtcNow.Date.AddDays(10),
        JobType = "routed",
        Jobs = new List<BulkImportJobCreateDto>
        {
            new() { JobNumber = "J1", FromAddress = "1 Pick St", ToAddress = "T", ToContact = "C", ToSuburb = toSuburb, ToPostCode = toPostCode },
        }
    };

    // The client's (or the tenant's) remembered fix is what gets booked;
    // another client's fix never leaks across, so that row is refused.
    [Theory]
    [InlineData(5)]
    [InlineData(null)]
    public async Task Routed_import_books_the_remembered_suburb(int? aliasClient)
    {
        var svc = RoutedSvc(out var seed, new TucSuburb { UcsuId = 1, UcsuName = "Ponsonby", PostCode = "1011" });
        seed.TblBulkSuburbAliases.Add(Row(1, aliasClient, "nowhereville", "0614", 1));
        await seed.SaveChangesAsync();

        var resp = await svc.Import(contactId: 1, Routed("Nowhereville", "614"));

        Assert.True(resp.Success, string.Join(" | ", resp.Messages.Select(m => m.Message)));
        var booked = Assert.Single(seed.TblBulkJobs.ToList());
        Assert.Equal(("Ponsonby", "Ponsonby"), (booked.ToSuburb, booked.DeliveryAddressLine5));
    }

    // The main suburb match uses the shared normaliser on both sides, so a
    // sheet "Mt Eden" books tucSuburb "Mount Eden" with no remembered fix.
    [Theory]
    [InlineData("Mt Eden", "Mount Eden")]
    [InlineData("ŌTĀHUHU", "Otahuhu")]
    public async Task Routed_import_books_the_normalised_suburb_match(string sheet, string booked)
    {
        var svc = RoutedSvc(out var seed, new TucSuburb { UcsuId = 1, UcsuName = "Mount Eden", PostCode = "1024" });
        await seed.SaveChangesAsync();

        var resp = await svc.Import(contactId: 1, Routed(sheet, "1024"));

        Assert.True(resp.Success, string.Join(" | ", resp.Messages.Select(m => m.Message)));
        Assert.Equal(booked, Assert.Single(seed.TblBulkJobs.ToList()).ToSuburb);
    }

    // Two real suburbs that normalise to one value: the exact spelling still
    // books its own suburb, and a spelling that matches neither exactly is
    // refused rather than guessed.
    [Theory]
    [InlineData("St Albans", "St Albans")]
    [InlineData("saint albans", "Saint Albans")]
    [InlineData("St. Albans", null)]
    public async Task Routed_import_never_guesses_between_suburbs_that_normalise_alike(string sheet, string booked)
    {
        var svc = RoutedSvc(out var seed,
            new TucSuburb { UcsuId = 1, UcsuName = "St Albans", PostCode = "8014" },
            new TucSuburb { UcsuId = 3, UcsuName = "Saint Albans", PostCode = "8014" });
        await seed.SaveChangesAsync();

        var resp = await svc.Import(contactId: 1, Routed(sheet, "8014"));

        if (booked == null)
        {
            Assert.False(resp.Success);
            Assert.Empty(seed.TblBulkJobs.ToList());
            return;
        }
        Assert.True(resp.Success, string.Join(" | ", resp.Messages.Select(m => m.Message)));
        Assert.Equal(booked, Assert.Single(seed.TblBulkJobs.ToList()).ToSuburb);
    }

    // Order: exact suburb name, then the remembered fix, then the normalised
    // match. The alias 'saint albans' (saved when 'St. Albans' was fixed to
    // Saint Albans) also matches a sheet 'St Albans', which is its own real
    // suburb and must book as itself; 'St. Albans' still takes the fix.
    [Theory]
    [InlineData("St Albans", "St Albans")]
    [InlineData("St. Albans", "Saint Albans")]
    // Spacing and a trailing dot are still the exact name, not the alias.
    [InlineData("St  Albans", "St Albans")]
    [InlineData("St Albans.", "St Albans")]
    [InlineData("St Albans", "St Albans")]
    [InlineData(" saint  albans ", "Saint Albans")]
    public async Task Routed_import_books_an_exact_suburb_name_over_a_remembered_fix(string sheet, string booked)
    {
        var svc = RoutedSvc(out var seed,
            new TucSuburb { UcsuId = 1, UcsuName = "St Albans", PostCode = "8014" },
            new TucSuburb { UcsuId = 3, UcsuName = "Saint Albans", PostCode = "8014" });
        seed.TblBulkSuburbAliases.Add(Row(1, 5, "saint albans", "8014", 3));
        await seed.SaveChangesAsync();

        var resp = await svc.Import(contactId: 1, Routed(sheet, "8014"));

        Assert.True(resp.Success, string.Join(" | ", resp.Messages.Select(m => m.Message)));
        Assert.Equal(booked, Assert.Single(seed.TblBulkJobs.ToList()).ToSuburb);
    }

    [Theory]
    [InlineData("Mt Eden", "Mount Eden")]
    [InlineData("mount eden", "Mount Eden")]
    [InlineData("St Albans", "St Albans")]
    [InlineData("St. Albans", null)]
    [InlineData("Nowhere", null)]
    [InlineData("Point Chevalier", "Pt Chevalier")]
    [InlineData("Mt.Eden", "Mount Eden")]
    public void Suburb_matcher_prefers_exact_and_needs_an_unambiguous_normalised_match(string sheet, string expected)
    {
        var match = BulkSuburbAliases.SuburbMatcher(new[] { "Mount Eden", "St Albans", "Saint Albans", "Pt Chevalier" });
        Assert.Equal(expected, match(sheet));
    }

    [Fact]
    public async Task Routed_import_ignores_another_clients_remembered_suburb()
    {
        var svc = RoutedSvc(out var seed, new TucSuburb { UcsuId = 1, UcsuName = "Ponsonby", PostCode = "1011" });
        seed.TblBulkSuburbAliases.Add(Row(1, 9, "nowhereville", "0614", 1));
        await seed.SaveChangesAsync();

        var resp = await svc.Import(contactId: 1, Routed("Nowhereville", "614"));

        Assert.False(resp.Success);
        Assert.Contains("delivery 'Nowhereville'", Assert.Single(resp.Messages).Message);
        Assert.Empty(seed.TblBulkJobs.ToList());
    }
}
