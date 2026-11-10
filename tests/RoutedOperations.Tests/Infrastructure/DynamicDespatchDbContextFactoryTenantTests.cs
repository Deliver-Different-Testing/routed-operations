using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Infrastructure;

public class DynamicDespatchDbContextFactoryTenantTests
{
    [Fact]
    public void AnAgentRequest_ResolvesTheTenantFromTheOverride_NotFromClaims()
    {
        var connections = Substitute.For<IConnectionStringManager>();
        connections.GetConnectionStringAsync(TenantConnectionCache.Key("7"))
            .Returns("Server=agent-db;Database=d;User ID=u;Password=p;TrustServerCertificate=true");
        var http = new DefaultHttpContext();
        http.Items[DynamicDespatchDbContextFactory.OverrideTenantIdItemsKey] = "7";
        var factory = new DynamicDespatchDbContextFactory(
            Options.Create(new DbContextOptions<DespatchContext>()), connections,
            new HttpContextAccessor { HttpContext = http });

        using var context = factory.CreateDbContext();

        Assert.Contains("agent-db", context.Database.GetConnectionString());
    }
}
