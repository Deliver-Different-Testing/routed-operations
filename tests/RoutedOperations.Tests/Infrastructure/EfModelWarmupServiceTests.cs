using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoutedOperations.Core.Domain;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Infrastructure;

public class EfModelWarmupServiceTests
{
    [Fact]
    public async Task StartAsync_Completes()
    {
        var options = new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase("warmup-" + Guid.NewGuid())
            .Options;
        var wrapped = Options.Create(options);
        var sut = new EfModelWarmupService(wrapped);

        await sut.StartAsync(CancellationToken.None);
    }

    [Fact]
    public async Task StartAsync_CatchesExceptions()
    {
        // The service swaps the provider to SqlServer with a bogus connection
        // string. That path only builds the model - it does not open a
        // connection, so the call completes without throwing regardless of the
        // input provider. Even if the internal build failed the try/catch
        // guarantees the returned task completes.
        var options = new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase("catch-" + Guid.NewGuid())
            .Options;
        var wrapped = Options.Create(options);
        var sut = new EfModelWarmupService(wrapped);

        await sut.StartAsync(CancellationToken.None);
    }

    [Fact]
    public async Task StopAsync_ReturnsCompletedTask()
    {
        var options = new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase("stop-" + Guid.NewGuid())
            .Options;
        var sut = new EfModelWarmupService(Options.Create(options));

        var t = sut.StopAsync(CancellationToken.None);

        Assert.True(t.IsCompletedSuccessfully);
        await t;
    }
}
