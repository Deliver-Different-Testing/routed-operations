// Governance for the Bulk Import customer opening (ro-bulk-import-customer-scope).
//
// Customers reach a controller only through BulkImport.Use. These tests make
// the two ways that could go wrong fail CI instead of shipping:
//   1. a new endpoint is added behind ro-bulk-import with neither the Bulk
//      Import policy nor an explicit staff policy, or a controller there is
//      moved back onto a policy nobody reviewed;
//   2. one of the staff-only actions loses its RouteBuilder.* gate, which is
//      the only thing keeping customers off it once the controller is open.
using System.Reflection;
using DeliverDifferent.AccessControl.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Security;

namespace RoutedOperations.Tests.Security;

public class BulkImportPolicyGovernanceTests
{
    private const string Key = "ro-bulk-import";
    private static readonly HashSet<string> StaffPolicies = ["RouteBuilder.Admin", "RouteBuilder.Build"];

    private static IEnumerable<Type> Controllers() =>
        typeof(BaseController).Assembly.GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t) && !t.IsAbstract);

    private static IEnumerable<MethodInfo> Actions(Type controller) =>
        controller.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    private static string[] Policies(MemberInfo m) =>
        m.GetCustomAttributes<AuthorizeAttribute>(inherit: true)
            .Select(a => a.Policy).Where(p => p != null).Cast<string>().ToArray();

    // The action-level declaration wins over the controller's (package XML,
    // RequireFeatureAttribute.IsTheDecidingDeclaration).
    private static string[] DecidingFeatureKeys(Type controller, MethodInfo action)
    {
        var onAction = action.GetCustomAttributes<RequireFeatureAttribute>(inherit: true).FirstOrDefault();
        if (onAction != null) return onAction.FeatureKeys.ToArray();
        if (action.GetCustomAttributes<NoFeatureCheckAttribute>(inherit: true).Any()) return [];
        return controller.GetCustomAttributes<RequireFeatureAttribute>(inherit: true)
            .SelectMany(a => a.FeatureKeys).ToArray();
    }

    private static IEnumerable<(Type Controller, MethodInfo Action)> BulkImportActions() =>
        Controllers().SelectMany(c => Actions(c).Select(a => (c, a)))
            .Where(x => DecidingFeatureKeys(x.c, x.a).Contains(Key));

    [Fact]
    public void Every_bulk_import_action_uses_the_bulk_import_policy_or_an_explicit_staff_policy()
    {
        var actions = BulkImportActions().ToList();
        Assert.NotEmpty(actions);

        var offenders = actions
            .Where(x =>
            {
                var all = Policies(x.Controller).Concat(Policies(x.Action)).ToArray();
                return !all.Contains(BulkImportPolicies.Use) && !all.Any(StaffPolicies.Contains);
            })
            .Select(x => $"{x.Controller.Name}.{x.Action.Name}")
            .ToList();
        Assert.Empty(offenders);
    }

    [Theory]
    [InlineData(typeof(BulkImportController))]
    [InlineData(typeof(ClientsController))]
    [InlineData(typeof(TemplatesController))]
    [InlineData(typeof(AddressController))]
    public void Bulk_import_controllers_sit_on_the_interim_policy_not_RouteBuilder_Admin(Type controller)
    {
        // Controller-level RouteBuilder.Admin would AND with BulkImport.Use and
        // shut customers out again; BulkImport.Use must be the controller policy.
        Assert.Equal([BulkImportPolicies.Use], Policies(controller));
    }

    [Theory]
    [InlineData(typeof(BulkImportController), nameof(BulkImportController.StaffImport), "RouteBuilder.Admin")]
    [InlineData(typeof(BulkImportController), nameof(BulkImportController.SearchJobsForBulkComplete), "RouteBuilder.Admin")]
    [InlineData(typeof(BulkImportController), nameof(BulkImportController.BulkCompleteJobs), "RouteBuilder.Admin")]
    [InlineData(typeof(ClientsController), nameof(ClientsController.GeocodeSite), "RouteBuilder.Admin")]
    [InlineData(typeof(ClientsController), nameof(ClientsController.GetJobNumber), "RouteBuilder.Admin")]
    [InlineData(typeof(AddressController), nameof(AddressController.ReverseGeocode), "RouteBuilder.Build")]
    [InlineData(typeof(AddressController), nameof(AddressController.ForwardGeocode), "RouteBuilder.Build")]
    public void Staff_only_actions_keep_their_staff_policy(Type controller, string action, string policy)
    {
        var method = Assert.Single(Actions(controller), m => m.Name == action);
        Assert.Contains(policy, Policies(method));
    }
}
