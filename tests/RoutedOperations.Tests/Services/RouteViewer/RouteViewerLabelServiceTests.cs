// What RouteViewerLabelService hands to the label package, and which
// template it picks. Ticket #855 (Medical prod, Nov 2026):
//
//   * Print Run on a routed run printed the wrong set of jobs because the
//     service dropped the filters the operator had picked and the package
//     searched by leg number instead of by the jobs on screen.
//   * Single Print on a Will Call job returned 501 because Medical's only
//     AlertTemplate is a bulk-type template and the job-label chain never
//     looked at it.
//
// IAlertLabelService is substituted and the request it receives is captured,
// so these run on the EF InMemory store with no SQL Server.
using DeliverDifferent.AlertLabel.Data.Models;
using DeliverDifferent.AlertLabel.Data.Services;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerLabelServiceTests
{
    private const int TemplateTypeOrderNotification = 1;
    private const int TemplateTypeLabel = 2;

    private sealed class Fixture
    {
        public required RouteViewerLabelService Sut { get; init; }
        public required IAlertLabelService Alert { get; init; }
        public AlertLabelRequest? Captured { get; set; }
    }

    // templates: (id, type). Settings row is always seeded so the default
    // label ids can be null the way Medical prod has them.
    private static Fixture NewFixture(
        (int Id, int Type)[] templates,
        int? defaultJobLabelId = null,
        int? defaultBulkLabelId = null,
        Action<DynamicDespatchDbContext>? seed = null,
        Dictionary<int, int>? clientTemplates = null)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        using (var ctx = RouteViewerTestHarness.Context(opts))
        {
            foreach (var (id, type) in templates)
                ctx.AlertTemplates.Add(new AlertTemplate { Id = id, Name = $"T{id}", TemplateType = type, PageSizeId = 4 });
            ctx.TblSettings.Add(new TblSetting
            {
                SettingId = 1,
                DefaultJobLabelId = defaultJobLabelId,
                DefaultBulkLabelId = defaultBulkLabelId,
            });
            seed?.Invoke(ctx);
            ctx.SaveChanges();
        }

        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var factory = RouteViewerTestHarness.Factory(opts);
        var alert = Substitute.For<IAlertLabelService>();
        Fixture? fx = null;
        alert.GeneratePdfAsync(Arg.Any<AlertLabelRequest>())
            .Returns(ci => { fx!.Captured = ci.Arg<AlertLabelRequest>(); return Task.FromResult(new byte[] { 1 }); });

        fx = new Fixture
        {
            Alert = alert,
            Sut = new RouteViewerLabelService(
                factory,
                alert,
                new FakeLabelTemplateResolver(factory, clientTemplates),
                resolver,
                Substitute.For<INpScopeGuard>(),
                new HttpClient(),
                NullLogger<RouteViewerLabelService>.Instance),
        };
        return fx;
    }

    // Medical prod shape: one AlertTemplate (Id 1, bulk type), both
    // tblSetting defaults NULL, Commingle Route (421) carries LabelId = 1,
    // Will Call (423) carries none.
    private static void SeedMedicalJobs(DynamicDespatchDbContext ctx)
    {
        ctx.TucJobTypes.Add(new TucJobType { UcjtId = 421, LabelId = 1 });
        ctx.TucJobTypes.Add(new TucJobType { UcjtId = 423, LabelId = null });
        ctx.TucJobs.Add(new TucJob { UcjbId = 17960, UcjbNumber = "P5543DEL", UcjbSpeed = 421, UcjbVoid = false });
        ctx.TucJobs.Add(new TucJob { UcjbId = 20857, UcjbNumber = "E896WILLDEL", UcjbSpeed = 423, UcjbVoid = false });
    }

    // ── Single job template chain ───────────────────────────────────────

    [Fact]
    public async Task SingleJob_SpeedHasLabel_UsesTheSpeedLabel()
    {
        var fx = NewFixture(new[] { (1, TemplateTypeLabel) }, seed: SeedMedicalJobs);

        await fx.Sut.GetSingleJobLabelAsync(17960);

        Assert.Equal(1, fx.Captured!.TemplateId);
        Assert.Equal(1, fx.Captured.Mode);
        Assert.Equal(17960, fx.Captured.JobId);
    }

    [Fact]
    public async Task SingleJob_WillCall_OnlyBulkTemplate_NoDefaults_UsesTheBulkTemplate()
    {
        // Was HTTP 501 "No AlertTemplate of TemplateType=1 configured" on
        // Medical prod (E896WILLDEL). The tenant's only template prints it.
        var fx = NewFixture(new[] { (1, TemplateTypeLabel) }, seed: SeedMedicalJobs);

        await fx.Sut.GetSingleJobLabelAsync(20857);

        Assert.Equal(1, fx.Captured!.TemplateId);
        Assert.Equal(1, fx.Captured.Mode);
        Assert.Equal(20857, fx.Captured.JobId);
    }

    [Fact]
    public async Task SingleJob_PrefersDefaultJobLabel_OverFirstJobTemplate()
    {
        var fx = NewFixture(new[] { (1, TemplateTypeOrderNotification), (5, TemplateTypeOrderNotification), (9, TemplateTypeLabel) },
            defaultJobLabelId: 5, defaultBulkLabelId: 9, seed: SeedMedicalJobs);

        await fx.Sut.GetSingleJobLabelAsync(20857);

        Assert.Equal(5, fx.Captured!.TemplateId);
    }

    [Fact]
    public async Task SingleJob_NoJobDefault_UsesFirstLabelTemplate_NeverAnOrderNotification()
    {
        // Ids 4 and 7 are order notifications (type 1) and sort ahead of the
        // label (id 9); the old chain picked 4 for a job label.
        var fx = NewFixture(new[] { (9, TemplateTypeLabel), (7, TemplateTypeOrderNotification), (4, TemplateTypeOrderNotification) },
            seed: SeedMedicalJobs);

        await fx.Sut.GetSingleJobLabelAsync(20857);

        Assert.Equal(9, fx.Captured!.TemplateId);
    }

    [Fact]
    public async Task SingleBulk_NoBulkDefault_UsesFirstLabelTemplate_NeverAnOrderNotification()
    {
        var fx = NewFixture(new[] { (3, TemplateTypeOrderNotification), (9, TemplateTypeLabel) }, seed: ctx =>
        {
            ctx.TucJobTypes.Add(new TucJobType { UcjtId = 423, LabelId = null });
            ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 10, ClientId = 1, Speed = 423, Void = false });
        });

        await fx.Sut.GetSingleBulkLabelAsync(10);

        Assert.Equal(9, fx.Captured!.TemplateId);
    }

    [Fact]
    public async Task SingleJob_OnlyOrderNotificationTemplates_LastResortStillPrints()
    {
        var fx = NewFixture(new[] { (3, TemplateTypeOrderNotification) }, seed: SeedMedicalJobs);

        await fx.Sut.GetSingleJobLabelAsync(20857);

        Assert.Equal(3, fx.Captured!.TemplateId);
    }

    [Fact]
    public async Task SingleJob_NoJobDefault_UsesFirstLabelTemplate_BeforeTheBulkDefault()
    {
        var fx = NewFixture(new[] { (2, TemplateTypeLabel), (3, TemplateTypeLabel) },
            defaultBulkLabelId: 3, seed: SeedMedicalJobs);

        await fx.Sut.GetSingleJobLabelAsync(20857);

        Assert.Equal(2, fx.Captured!.TemplateId);
    }

    [Fact]
    public async Task SingleJob_SpeedLabelPointsAtMissingTemplate_FallsBackToTheChain()
    {
        var fx = NewFixture(new[] { (2, TemplateTypeLabel) }, seed: ctx =>
        {
            ctx.TucJobTypes.Add(new TucJobType { UcjtId = 500, LabelId = 99 });
            ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "J1", UcjbSpeed = 500, UcjbVoid = false });
        });

        await fx.Sut.GetSingleJobLabelAsync(1);

        Assert.Equal(2, fx.Captured!.TemplateId);
    }

    [Fact]
    public async Task BulkRun_OnlyJobTemplates_UsesDefaultJobLabel()
    {
        // Bulk chain mirrors the job chain: no bulk template on the tenant
        // falls back to the job default rather than failing.
        var fx = NewFixture(new[] { (6, TemplateTypeOrderNotification), (8, TemplateTypeOrderNotification) }, defaultJobLabelId: 8);

        await fx.Sut.GetBulkLabelsAsync(new LabelRequest { BookDate = new DateTime(2026, 11, 4) });

        Assert.Equal(8, fx.Captured!.TemplateId);
    }

    // ── Client label template ───────────────────────────────────────────

    // Client 77 has template 20 (bulk-type is fine: the client template
    // serves job and bulk labels alike). Speed 421 carries label 1.
    private static void SeedClientJobs(DynamicDespatchDbContext ctx)
    {
        ctx.TucJobTypes.Add(new TucJobType { UcjtId = 421, LabelId = 1 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "WITH", UcjbSpeed = 421, UcjbClientId = 77, UcjbVoid = false });
        ctx.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "WITHOUT", UcjbSpeed = 421, UcjbClientId = 78, UcjbVoid = false });
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 10, ClientId = 77, Speed = 421, Void = false });
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 11, ClientId = 78, Speed = 421, Void = false });
    }

    private static Fixture ClientFixture(int? defaultJobLabelId = null, int? defaultBulkLabelId = null) =>
        NewFixture(new[] { (1, TemplateTypeOrderNotification), (20, TemplateTypeOrderNotification), (5, TemplateTypeOrderNotification), (6, TemplateTypeLabel) },
            defaultJobLabelId, defaultBulkLabelId, SeedClientJobs, new Dictionary<int, int> { [77] = 20 });

    [Fact]
    public async Task SingleJob_ClientTemplate_BeatsTheSpeedLabel()
    {
        var fx = ClientFixture(defaultJobLabelId: 5);

        await fx.Sut.GetSingleJobLabelAsync(1);

        Assert.Equal(20, fx.Captured!.TemplateId);
    }

    [Fact]
    public async Task SingleJob_ClientWithoutTemplate_KeepsSpeedThenDefault()
    {
        var fx = ClientFixture(defaultJobLabelId: 5);

        await fx.Sut.GetSingleJobLabelAsync(2);
        Assert.Equal(1, fx.Captured!.TemplateId);

        var noSpeedLabel = NewFixture(new[] { (5, TemplateTypeOrderNotification) }, defaultJobLabelId: 5, seed: ctx =>
        {
            ctx.TucJobTypes.Add(new TucJobType { UcjtId = 421, LabelId = null });
            ctx.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "WITHOUT", UcjbSpeed = 421, UcjbClientId = 78, UcjbVoid = false });
        });
        await noSpeedLabel.Sut.GetSingleJobLabelAsync(2);
        Assert.Equal(5, noSpeedLabel.Captured!.TemplateId);
    }

    [Fact]
    public async Task SingleJob_ClientWithoutTemplate_NoDefaults_StillUsesTheFallbackChain()
    {
        var fx = NewFixture(new[] { (4, TemplateTypeOrderNotification), (2, TemplateTypeLabel) }, seed: ctx =>
        {
            ctx.TucJobTypes.Add(new TucJobType { UcjtId = 421, LabelId = null });
            ctx.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "WITHOUT", UcjbSpeed = 421, UcjbClientId = 78, UcjbVoid = false });
        });

        await fx.Sut.GetSingleJobLabelAsync(2);

        Assert.Equal(2, fx.Captured!.TemplateId);
    }

    [Fact]
    public async Task SingleBulk_ClientTemplate_BeatsTheSpeedLabel_AndNoTemplateKeepsToday()
    {
        var fx = ClientFixture(defaultBulkLabelId: 6);

        await fx.Sut.GetSingleBulkLabelAsync(10);
        Assert.Equal(20, fx.Captured!.TemplateId);
        Assert.Equal(2, fx.Captured.Mode);

        await fx.Sut.GetSingleBulkLabelAsync(11);
        Assert.Equal(1, fx.Captured.TemplateId);
    }

    [Fact]
    public async Task Lhp_ClientTemplate_WinsOverTheDefaultBulkTemplate()
    {
        var fx = ClientFixture(defaultBulkLabelId: 6);

        await fx.Sut.GetLhpJobLabelAsync(1);

        Assert.Equal(20, fx.Captured!.TemplateId);
        Assert.Equal(1, fx.Captured.Mode);
    }

    [Fact]
    public async Task Lhp_ClientWithoutTemplate_UsesTheDefaultBulkTemplate_NotTheSpeedLabel()
    {
        var fx = ClientFixture(defaultBulkLabelId: 6);

        await fx.Sut.GetLhpJobLabelAsync(2);

        Assert.Equal(6, fx.Captured!.TemplateId);
    }

    [Fact]
    public async Task SingleJob_NoTemplatesAtAll_ThrowsWithOpsMessage()
    {
        // Cheetah prod shape: zero AlertTemplate rows. Still 501, but the
        // message now tells ops what to configure.
        var fx = NewFixture(Array.Empty<(int, int)>(), seed: SeedMedicalJobs);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => fx.Sut.GetSingleJobLabelAsync(17960));
        Assert.Contains("No label template is configured", ex.Message);
        await fx.Alert.DidNotReceive().GeneratePdfAsync(Arg.Any<AlertLabelRequest>());
    }

    [Fact]
    public async Task BulkRun_NoTemplatesAtAll_Throws()
    {
        var fx = NewFixture(Array.Empty<(int, int)>());

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fx.Sut.GetBulkLabelsAsync(new LabelRequest { BookDate = new DateTime(2026, 11, 4) }));
        await fx.Alert.DidNotReceive().GeneratePdfAsync(Arg.Any<AlertLabelRequest>());
    }

    // ── Bulk run request pass-through ───────────────────────────────────

    [Fact]
    public async Task BulkRun_Mode4_PassesSpeedBulkJobIdsAndSort()
    {
        // Was: SpeedIds and BulkJobIds dropped, so the Speed filter and the
        // jobs on screen made no difference to a bulk-run print.
        var fx = NewFixture(new[] { (1, TemplateTypeLabel) });

        await fx.Sut.GetBulkLabelsAsync(new LabelRequest
        {
            BookDate = new DateTime(2026, 11, 4),
            BulkJobIds = "5,6",
            SpeedIds = "421",
            SortMode = 3,
            SortDir = 2,
        });

        var r = fx.Captured!;
        Assert.Equal(4, r.Mode);
        Assert.Equal(1, r.TemplateId);
        Assert.Equal("421", r.SpeedIds);
        Assert.Equal("5,6", r.BulkJobIds);
        Assert.Null(r.JobIds);
        Assert.Equal(3, r.SortMode);
        Assert.Equal(2, r.SortDir);
    }

    [Fact]
    public async Task RouteRun_JobIds_GoesToMode8WithEverythingTheOperatorPicked()
    {
        // Medical prod 4 Nov, Burbank to Lab: the grid shows 38 DEL legs plus
        // the two Will Call LHP legs. Before #855 Mode 8 got none of the
        // filters and printed only the two LHP legs.
        var fx = NewFixture(new[] { (1, TemplateTypeLabel) });

        await fx.Sut.GetBulkLabelsAsync(new LabelRequest
        {
            BookDate = new DateTime(2026, 11, 4, 15, 30, 0),
            RunName = "  Burbank to Lab ",
            JobIds = "17960, 20849,20858,",
            SpeedIds = "423",
            SortMode = 2,
        });

        var r = fx.Captured!;
        Assert.Equal(8, r.Mode);
        Assert.Equal(new DateTime(2026, 11, 4), r.BookDate);
        Assert.Equal("Burbank to Lab", r.RunName);
        Assert.Equal("17960,20849,20858", r.JobIds);
        Assert.Equal("423", r.SpeedIds);
        Assert.Null(r.BulkJobIds);
        Assert.Equal(2, r.SortMode);
        Assert.Equal(1, r.SortDir);
    }

    [Fact]
    public async Task RouteRun_DefaultSort_IsRunOrder()
    {
        var fx = NewFixture(new[] { (1, TemplateTypeLabel) });

        await fx.Sut.GetBulkLabelsAsync(new LabelRequest { BookDate = new DateTime(2026, 11, 4), JobIds = "1" });

        Assert.Equal(1, fx.Captured!.SortMode);
        Assert.Equal(1, fx.Captured.SortDir);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData(" , ,", null)]
    [InlineData("0,-3,abc", null)]
    [InlineData("12", "12")]
    [InlineData(" 12, 7 ,12,x,0,", "12,7")]
    public void NormalizeIdCsv_KeepsOnlyPositiveIds(string? input, string? expected)
    {
        Assert.Equal(expected, RouteViewerLabelService.NormalizeIdCsv(input));
    }
}
