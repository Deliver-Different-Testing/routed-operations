// #816: RVW_stpPreAssignRun / RVW_stpUnAssignRun (migration
// 20261116110200) RAISERROR when the courier code is unknown or inactive,
// instead of writing status 18 with no courier. The operator has to see
// that message. Before this, the SqlException escaped the controller as a
// 500 and the run menu showed a generic HTTP error.
//
// InMemory cannot run stored procedures, so the context points at SQL
// Server with an interceptor that suppresses the connection and makes the
// EXEC fail the way the proc does (error 50000, severity 16).
using System.Data.Common;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Tests.Controllers;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerRunCourierRejectTests
{
    private const string PreAssignMsg = "Courier code 'ZZ9' was not found or is not active. No jobs were pre-assigned.";
    private const string UnassignMsg = "Courier code 'ZZ9' was not found or is not active. No jobs were unassigned.";

    private sealed class ProcRaises(string message) : DbCommandInterceptor, IDbConnectionInterceptor
    {
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
            => throw MakeSqlException(50000, message);

        public ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
            => ValueTask.FromResult(InterceptionResult.Suppress());

        public InterceptionResult ConnectionOpening(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result) => InterceptionResult.Suppress();
    }

    // SqlException has no public constructor; build one the way the client
    // does when the server sends an error token.
    private static SqlException MakeSqlException(int number, string message)
    {
        const BindingFlags Any = BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static;
        var errorCtor = typeof(SqlError).GetConstructors(Any).OrderByDescending(c => c.GetParameters().Length).First();
        var args = errorCtor.GetParameters().Select(p => p.Name switch
        {
            "infoNumber" or "number" => (object?)number,
            "errorState" or "state" => (object?)(byte)1,
            "errorClass" or "class" => (object?)(byte)16,
            "errorMessage" or "message" => message,
            "server" or "procedure" => "",
            _ => p.ParameterType.IsValueType ? Activator.CreateInstance(p.ParameterType) : null,
        }).ToArray();
        var error = (SqlError)errorCtor.Invoke(args);
        var errors = (SqlErrorCollection)typeof(SqlErrorCollection).GetConstructors(Any)[0].Invoke(null);
        typeof(SqlErrorCollection).GetMethod("Add", Any)!.Invoke(errors, [error]);
        var create = typeof(SqlException).GetMethods(Any)
            .First(m => m.Name == "CreateException" && m.GetParameters().Length == 2
                && m.GetParameters()[0].ParameterType == typeof(SqlErrorCollection));
        return (SqlException)create.Invoke(null, [errors, "16.0"])!;
    }

    private static RunViewerAssignmentController NewCtl(string procMessage)
    {
        var opts = new DbContextOptionsBuilder<DespatchContext>()
            .UseSqlServer("Server=unused;Database=unused;Trusted_Connection=True;")
            .AddInterceptors(new ProcRaises(procMessage))
            .Options;
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var svc = new RouteViewerAssignmentService(factory, resolver, Substitute.For<INpScopeGuard>(),
            RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted(),
            NullLogger<RouteViewerAssignmentService>.Instance);
        var ctl = new RunViewerAssignmentController(svc);
        ControllerTestHarness.AttachHttpContext(ctl);
        return ctl;
    }

    private static string? MessageOf(IActionResult result)
    {
        var bad = Assert.IsType<BadRequestObjectResult>(result);
        return bad.Value!.GetType().GetProperty("message")!.GetValue(bad.Value) as string;
    }

    [Fact]
    public async Task Pre_assign_to_an_unknown_courier_returns_the_procs_message_as_a_400()
    {
        var ctl = NewCtl(PreAssignMsg);

        var result = await ctl.PreAssignRun(new PreAssignRunRequest
        { RunId = 41, FromCourierCode = "C7", ToCourierCode = "ZZ9" });

        Assert.Equal(PreAssignMsg, MessageOf(result));
    }

    [Fact]
    public async Task Unassign_of_an_unknown_courier_returns_the_procs_message_as_a_400()
    {
        var ctl = NewCtl(UnassignMsg);

        var result = await ctl.UnAssignRun(new UnAssignRunRequest { RunId = 41, CourierCode = "ZZ9" });

        Assert.Equal(UnassignMsg, MessageOf(result));
    }
}
