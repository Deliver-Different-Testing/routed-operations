// Server-side Access Control switches (Routed Ops switches spec step 3b).
//
// [RequireFeature] is only as good as its keys: a key that is not seeded in
// dbo.Feature is granted to nobody, so the endpoint would answer DF Admin and
// 403 everyone else. These pin every declared key to the migration's list and
// pin which switch each controller sits behind, so a change to either is a
// deliberate edit here rather than a silent outage.
using System.Reflection;
using DeliverDifferent.AccessControl.Authorization;
using RoutedOperations.API.Controllers;

namespace RoutedOperations.Tests.Security;

public class RequireFeatureGovernanceTests
{
    // Mirror of dbmigrationsv2 20261009180000_RoutedOpsAccessSwitchKeys.sql and
    // wwwroot/app/react/lib/accessSwitches.ts RO_FEATURE_KEYS.
    private static readonly HashSet<string> SeededKeys =
    [
        "ro-dashboard", "ro-bulk-import", "ro-route-builder", "ro-route-viewer",
        "ro-route-viewer-runs", "ro-linehaul", "ro-scan-manager", "ro-print-manager",
        "ro-customer-services", "ro-mobile", "ro-quoting", "ro-recurring-routes",
        "ro-schedules", "ro-schedules-new", "ro-client-overrides", "ro-driver-rostering",
        "ro-polygon-builder", "ro-auto-assign-log", "ro-historic-archive",
    ];

    private static IEnumerable<RequireFeatureAttribute> AllDeclarations()
    {
        foreach (var type in typeof(BaseController).Assembly.GetTypes().Where(t => typeof(Microsoft.AspNetCore.Mvc.ControllerBase).IsAssignableFrom(t)))
        {
            foreach (var a in type.GetCustomAttributes<RequireFeatureAttribute>(inherit: true)) yield return a;
            foreach (var m in type.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly))
            {
                foreach (var a in m.GetCustomAttributes<RequireFeatureAttribute>(inherit: true)) yield return a;
            }
        }
    }

    [Fact]
    public void Every_declared_key_is_seeded()
    {
        var keys = AllDeclarations().SelectMany(a => a.FeatureKeys).Distinct().ToList();
        Assert.NotEmpty(keys);
        Assert.All(keys, k => Assert.Contains(k, SeededKeys));
    }

    [Theory]
    [InlineData(typeof(AutoAssignLogController), "ro-auto-assign-log")]
    [InlineData(typeof(BulkImportController), "ro-bulk-import")]
    [InlineData(typeof(TemplatesController), "ro-bulk-import")]
    [InlineData(typeof(HistoricArchiveController), "ro-historic-archive")]
    [InlineData(typeof(QuoteController), "ro-quoting")]
    [InlineData(typeof(DriverSchedulingController), "ro-driver-rostering")]
    [InlineData(typeof(ZonesController), "ro-polygon-builder")]
    public void Single_page_controllers_sit_behind_their_pages_switch(Type controller, string key)
    {
        // Step 3b-1. Each of these is called by exactly one page.
        var attr = Assert.Single(controller.GetCustomAttributes<RequireFeatureAttribute>(inherit: true));
        Assert.Equal([key], attr.FeatureKeys);
    }

    [Theory]
    [InlineData(typeof(CouriersController))]
    [InlineData(typeof(FleetsController))]
    [InlineData(typeof(RegionsController))]
    [InlineData(typeof(JobsController))]
    [InlineData(typeof(RunsController))]
    [InlineData(typeof(RoutesController))]
    [InlineData(typeof(SpeedsController))]
    [InlineData(typeof(VehicleSizesController))]
    public void Route_builder_lookups_sit_behind_route_builder(Type controller)
    {
        // Step 3b-2. Only the Route Builder cockpit calls these.
        var attr = Assert.Single(controller.GetCustomAttributes<RequireFeatureAttribute>(inherit: true));
        Assert.Equal(["ro-route-builder"], attr.FeatureKeys);
    }

    [Fact]
    public void Address_admits_any_of_the_three_pages_that_call_it()
    {
        var attr = Assert.Single(typeof(AddressController).GetCustomAttributes<RequireFeatureAttribute>(inherit: true));
        Assert.Equal(
            new HashSet<string> { "ro-bulk-import", "ro-route-builder", "ro-recurring-routes" },
            attr.FeatureKeys.ToHashSet());
    }

    [Fact]
    public void Clients_is_bulk_import_except_geocode_which_schedules_new_owns()
    {
        var controllerAttr = Assert.Single(typeof(ClientsController).GetCustomAttributes<RequireFeatureAttribute>(inherit: true));
        Assert.Equal(["ro-bulk-import"], controllerAttr.FeatureKeys);

        // Action-level declaration REPLACES the controller's (most specific wins).
        var geocode = typeof(ClientsController).GetMethod(nameof(ClientsController.GeocodeSite))!;
        var actionAttr = Assert.Single(geocode.GetCustomAttributes<RequireFeatureAttribute>(inherit: true));
        Assert.Equal(new HashSet<string> { "ro-schedules-new", "ro-client-overrides" }, actionAttr.FeatureKeys.ToHashSet());
    }

    // Step 3b-3. Each Route Viewer controller admits ANY of the sub-pages that
    // call it (traced from the SPA's call sites). The group switch
    // (ro-route-viewer) is enforced by the menu and route guard; the server
    // can only express any-of, so it checks the page keys.
    public static TheoryData<Type, string[]> RouteViewerMap => new()
    {
        { typeof(RunViewerRunController), ["ro-route-viewer-runs", "ro-linehaul", "ro-scan-manager", "ro-print-manager", "ro-customer-services", "ro-mobile"] },
        { typeof(RunViewerJobController), ["ro-route-viewer-runs", "ro-linehaul", "ro-scan-manager", "ro-print-manager", "ro-customer-services", "ro-mobile"] },
        { typeof(RunViewerJobActionController), ["ro-route-viewer-runs", "ro-print-manager", "ro-mobile", "ro-customer-services", "ro-linehaul"] },
        { typeof(RunViewerFilterController), ["ro-route-viewer-runs", "ro-scan-manager", "ro-print-manager", "ro-linehaul"] },
        { typeof(RunViewerScanController), ["ro-scan-manager", "ro-route-viewer-runs", "ro-print-manager", "ro-linehaul"] },
        { typeof(RunViewerLabelController), ["ro-route-viewer-runs", "ro-print-manager", "ro-linehaul"] },
        { typeof(RunViewerCourierController), ["ro-route-viewer-runs", "ro-linehaul", "ro-mobile"] },
        { typeof(RunViewerAssignmentController), ["ro-route-viewer-runs", "ro-linehaul"] },
        { typeof(RunViewerReportController), ["ro-route-viewer-runs", "ro-linehaul"] },
        { typeof(RunViewerEventController), ["ro-route-viewer-runs", "ro-customer-services"] },
        { typeof(RunViewerBookingController), ["ro-route-viewer-runs"] },
        { typeof(RunViewerRouteTransferController), ["ro-route-viewer-runs"] },
    };

    [Theory]
    [MemberData(nameof(RouteViewerMap))]
    public void Route_viewer_controllers_admit_the_pages_that_call_them(Type controller, string[] keys)
    {
        var attr = Assert.Single(controller.GetCustomAttributes<RequireFeatureAttribute>(inherit: true));
        Assert.Equal(keys.ToHashSet(), attr.FeatureKeys.ToHashSet());
    }

    [Fact]
    public void Every_route_viewer_controller_is_switched()
    {
        // A new RunViewer* controller must not open ungated.
        var unswitched = typeof(BaseController).Assembly.GetTypes()
            .Where(t => t.Name.StartsWith("RunViewer") && t.Name.EndsWith("Controller") && !t.IsAbstract)
            .Where(t => !t.GetCustomAttributes<RequireFeatureAttribute>(inherit: true).Any())
            .Select(t => t.Name)
            .ToList();
        Assert.Empty(unswitched);
    }

    // Step 3b-4. Schedules / Recurring Routes / Polygon Builder share endpoints
    // heavily, so each action is keyed to the pages that CALL it (traced from
    // the SPA), not to the page its route prefix suggests. Row with "" = the
    // controller default (the owning page); named rows are action overrides,
    // which replace the default. Client Overrides opens the same detail modal
    // as Schedules (NEW), so every modal call admits both.
    private static readonly (Type Controller, string Action, string[] Keys)[] SchedulesClusterRows =
    [
        (typeof(BulkPolygonsController), "", ["ro-polygon-builder"]),
        (typeof(BulkPolygonsController), nameof(BulkPolygonsController.GetAll), ["ro-polygon-builder", "ro-schedules", "ro-schedules-new", "ro-client-overrides"]),
        (typeof(BulkPolygonsController), nameof(BulkPolygonsController.GetOne), ["ro-recurring-routes"]),
        (typeof(RecurringRoutesController), "", ["ro-recurring-routes"]),
        (typeof(RecurringRoutesController), nameof(RecurringRoutesController.SearchZipcodes), ["ro-polygon-builder"]),
        (typeof(RecurringRoutesController), nameof(RecurringRoutesController.Create), ["ro-recurring-routes", "ro-polygon-builder"]),
        (typeof(RecurringRoutesController), nameof(RecurringRoutesController.GetAllZipcodeCentroids), ["ro-recurring-routes", "ro-polygon-builder"]),
        (typeof(RecurringRoutesController), nameof(RecurringRoutesController.GetAssignableTargets), ["ro-recurring-routes", "ro-polygon-builder"]),
        (typeof(RecurringRoutesController), nameof(RecurringRoutesController.GetSchedulesLookup), ["ro-recurring-routes", "ro-polygon-builder"]),
        (typeof(RecurringRoutesController), nameof(RecurringRoutesController.GetAll), ["ro-recurring-routes", "ro-schedules-new", "ro-client-overrides"]),
        (typeof(RecurringRoutesController), nameof(RecurringRoutesController.GetRoster), ["ro-recurring-routes", "ro-schedules-new", "ro-client-overrides"]),
        (typeof(RecurringRoutesController), nameof(RecurringRoutesController.GetPolygonShapes), ["ro-recurring-routes", "ro-polygon-builder", "ro-schedules", "ro-schedules-new", "ro-client-overrides"]),
        (typeof(RecurringLinehaulJobsController), "", ["ro-recurring-routes"]),
        (typeof(RecurringLinehaulRostersController), "", ["ro-recurring-routes"]),
        (typeof(RecurringLinehaulRostersController), nameof(RecurringLinehaulRostersController.GetGrid), ["ro-recurring-routes", "ro-schedules-new", "ro-client-overrides"]),
        (typeof(RecurringLinehaulRunsController), "", ["ro-recurring-routes"]),
        (typeof(RecurringLinehaulRunsController), nameof(RecurringLinehaulRunsController.GetAll), ["ro-recurring-routes", "ro-schedules-new", "ro-client-overrides"]),
        (typeof(RecurringLinehaulRunsController), nameof(RecurringLinehaulRunsController.Get), ["ro-schedules"]),
        (typeof(RecurringLinehaulRunsController), nameof(RecurringLinehaulRunsController.Create), ["ro-recurring-routes", "ro-schedules"]),
        (typeof(RecurringLinehaulRunsController), nameof(RecurringLinehaulRunsController.Update), ["ro-recurring-routes", "ro-schedules"]),
        (typeof(RecurringLinehaulRunsController), nameof(RecurringLinehaulRunsController.Delete), ["ro-recurring-routes", "ro-schedules"]),
        (typeof(SchedulesController), "", ["ro-schedules"]),
        (typeof(SchedulesController), nameof(SchedulesController.GetLookups), ["ro-schedules", "ro-schedules-new", "ro-client-overrides"]),
        (typeof(SchedulesController), nameof(SchedulesController.SearchClients), ["ro-schedules", "ro-schedules-new", "ro-client-overrides"]),
        (typeof(SchedulesController), nameof(SchedulesController.ToggleAutoBook), ["ro-schedules", "ro-schedules-new"]),
        (typeof(SchedulesV2Controller), "", ["ro-schedules-new", "ro-client-overrides"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.ListClientOverrides), ["ro-client-overrides"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.Retire), ["ro-schedules-new"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.SetIsActive), ["ro-schedules-new"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.Copy), ["ro-schedules-new"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.ClientSchedules), ["ro-schedules-new"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.CreateBundle), ["ro-schedules-new"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.UpdateBundle), ["ro-schedules-new"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.AddBundleMembers), ["ro-schedules-new"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.RemoveBundleMember), ["ro-schedules-new"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.DeleteBundle), ["ro-schedules-new"]),
        (typeof(SchedulesV2Controller), nameof(SchedulesV2Controller.AttachClientsToBundle), ["ro-schedules-new"]),
        (typeof(TerritoryController), "", ["ro-schedules"]),
        (typeof(TerritoryController), nameof(TerritoryController.GetPostcodesForSchedule), ["ro-schedules", "ro-schedules-new", "ro-client-overrides"]),
        (typeof(TerritoryController), nameof(TerritoryController.GetNzPostcodes), ["ro-schedules-new", "ro-client-overrides"]),
        (typeof(TerritoryController), nameof(TerritoryController.GetUsZipZones), ["ro-schedules-new", "ro-client-overrides"]),
    ];

    public static TheoryData<Type, string, string[]> SchedulesClusterMap
    {
        get
        {
            var data = new TheoryData<Type, string, string[]>();
            foreach (var (c, a, k) in SchedulesClusterRows) data.Add(c, a, k);
            return data;
        }
    }

    [Theory]
    [MemberData(nameof(SchedulesClusterMap))]
    public void Schedules_cluster_actions_admit_the_pages_that_call_them(Type controller, string action, string[] keys)
    {
        MemberInfo target = action == "" ? controller : controller.GetMethod(action)!;
        var attr = Assert.Single(target.GetCustomAttributes<RequireFeatureAttribute>(inherit: true));
        Assert.Equal(keys.ToHashSet(), attr.FeatureKeys.ToHashSet());
    }

    [Fact]
    public void Schedules_cluster_has_no_override_outside_the_map()
    {
        // A new action-level key on these controllers must be added to the map
        // (and so to the review), not slip in unrecorded.
        var mapped = SchedulesClusterRows.Select(r => (r.Controller, r.Action)).ToHashSet();
        var declared = mapped.Select(r => r.Item1).Distinct()
            .SelectMany(t => t.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
                .Where(m => m.GetCustomAttributes<RequireFeatureAttribute>(inherit: true).Any())
                .Select(m => (t, m.Name)))
            .ToList();
        Assert.All(declared, d => Assert.Contains(d, mapped));
    }

    [Theory]
    [InlineData(nameof(TerritoryController.GetPostcodesForSchedule))]
    [InlineData(nameof(TerritoryController.GetNzPostcodes))]
    [InlineData(nameof(TerritoryController.GetUsZipZones))]
    public void Schedule_create_path_territory_reads_stay_open_to_schedules_new(string action)
    {
        // Load-bearing: Schedules (NEW) create/edit calls these. Narrowing one
        // to ro-schedules breaks schedule creation (an error, not a hidden page).
        var attr = Assert.Single(typeof(TerritoryController).GetMethod(action)!.GetCustomAttributes<RequireFeatureAttribute>(inherit: true));
        Assert.Contains("ro-schedules-new", attr.FeatureKeys);
        Assert.Contains("ro-client-overrides", attr.FeatureKeys);
    }

    [Fact]
    public void Every_controller_is_switched_or_explicitly_opted_out()
    {
        // No controller opens ungated by omission: it names its switch or says
        // why none applies.
        var unswitched = typeof(BaseController).Assembly.GetTypes()
            .Where(t => typeof(Microsoft.AspNetCore.Mvc.ControllerBase).IsAssignableFrom(t) && !t.IsAbstract)
            .Where(t => !t.GetCustomAttributes<RequireFeatureAttribute>(inherit: true).Any()
                     && !t.GetCustomAttributes<NoFeatureCheckAttribute>(inherit: true).Any())
            .Select(t => t.Name)
            .ToList();
        Assert.Empty(unswitched);
    }
}
