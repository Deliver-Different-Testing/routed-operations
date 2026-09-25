using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Infrastructure;

public class ConnectionStringManagerTests
{
    private static (ConnectionStringManager Sut, FakeDistributedCache Distributed, IMemoryCache Memory) NewSut(
        FakeDistributedCache? preset = null)
    {
        var distributed = preset ?? new FakeDistributedCache();
        var memory = new MemoryCache(new MemoryCacheOptions());
        return (new ConnectionStringManager(distributed, memory), distributed, memory);
    }

    [Fact]
    public async Task SetAsync_NullConnectionString_Throws()
    {
        var (sut, _, _) = NewSut();

        await Assert.ThrowsAsync<ArgumentNullException>(() =>
            sut.SetConnectionStringAsync("tenant1", string.Empty));
    }

    [Fact]
    public async Task SetAsync_WritesToBothCaches()
    {
        var (sut, distributed, memory) = NewSut();

        await sut.SetConnectionStringAsync("tenant1", "Server=x;");

        Assert.True(memory.TryGetValue<string>("tenant1", out var cached));
        Assert.Equal("Server=x;", cached);
        Assert.Equal("Server=x;", distributed.Store["tenant1"]);
    }

    [Fact]
    public async Task SetAsync_DistributedFailureLoggedButMemoryStillSet()
    {
        var throwing = new FakeDistributedCache { ThrowOnWrite = true };
        var (sut, _, memory) = NewSut(throwing);

        await sut.SetConnectionStringAsync("tenant2", "Server=y;");

        Assert.True(memory.TryGetValue<string>("tenant2", out var cached));
        Assert.Equal("Server=y;", cached);
    }

    [Fact]
    public async Task GetAsync_MemoryHit_SkipsDistributed()
    {
        var (sut, distributed, memory) = NewSut();
        memory.Set("t1", "connA");

        var v = await sut.GetConnectionStringAsync("t1");

        Assert.Equal("connA", v);
        Assert.Equal(0, distributed.GetCalls);
    }

    [Fact]
    public async Task GetAsync_MemoryMissDistributedHit_PromotesToMemory()
    {
        var distributed = new FakeDistributedCache();
        distributed.Store["t2"] = "connFromRedis";
        var (sut, _, memory) = NewSut(distributed);

        var v = await sut.GetConnectionStringAsync("t2");

        Assert.Equal("connFromRedis", v);
        Assert.True(memory.TryGetValue<string>("t2", out var promoted));
        Assert.Equal("connFromRedis", promoted);
    }

    [Fact]
    public async Task GetAsync_BothMiss_ReturnsNull()
    {
        var (sut, _, _) = NewSut();

        var v = await sut.GetConnectionStringAsync("nope");

        Assert.Null(v);
    }

    [Fact]
    public async Task GetAsync_DistributedRetriesOnTransientErrorThenSucceeds()
    {
        var distributed = new FakeDistributedCache
        {
            FailReadsFirstN = 1,
        };
        distributed.Store["retry"] = "ok";
        var (sut, _, _) = NewSut(distributed);

        var v = await sut.GetConnectionStringAsync("retry");

        Assert.Equal("ok", v);
        Assert.Equal(2, distributed.GetCalls);
    }

    [Fact]
    public async Task GetAsync_DistributedAlwaysThrows_ReturnsNullAfterMaxAttempts()
    {
        var distributed = new FakeDistributedCache { FailReadsFirstN = int.MaxValue };
        var (sut, _, _) = NewSut(distributed);

        var v = await sut.GetConnectionStringAsync("bad");

        Assert.Null(v);
        Assert.Equal(3, distributed.GetCalls);
    }

    [Fact]
    public async Task GetAsync_MemoryHitButEmptyString_FallsThroughToDistributed()
    {
        var distributed = new FakeDistributedCache();
        distributed.Store["k"] = "fromRedis";
        var (sut, _, memory) = NewSut(distributed);
        memory.Set("k", string.Empty);

        var v = await sut.GetConnectionStringAsync("k");

        Assert.Equal("fromRedis", v);
    }

    /// <summary>
    /// Small in-memory fake of IDistributedCache. Substitute struggled here
    /// because both SetStringAsync + GetStringAsync are extension methods that
    /// dispatch to different member overloads; a hand-rolled fake keeps intent
    /// obvious and side-effects visible on plain properties.
    /// </summary>
    private sealed class FakeDistributedCache : IDistributedCache
    {
        public Dictionary<string, string> Store { get; } = new();
        public int GetCalls;
        public bool ThrowOnWrite;
        public int FailReadsFirstN;

        public byte[]? Get(string key) => throw new NotImplementedException();
        public Task<byte[]?> GetAsync(string key, CancellationToken token = default)
        {
            GetCalls++;
            if (FailReadsFirstN > 0)
            {
                FailReadsFirstN--;
                throw new InvalidOperationException("read failed");
            }
            return Task.FromResult<byte[]?>(
                Store.TryGetValue(key, out var v)
                    ? System.Text.Encoding.UTF8.GetBytes(v)
                    : null);
        }
        public void Refresh(string key) { }
        public Task RefreshAsync(string key, CancellationToken token = default) => Task.CompletedTask;
        public void Remove(string key) => Store.Remove(key);
        public Task RemoveAsync(string key, CancellationToken token = default) { Store.Remove(key); return Task.CompletedTask; }
        public void Set(string key, byte[] value, DistributedCacheEntryOptions options)
            => Store[key] = System.Text.Encoding.UTF8.GetString(value);
        public Task SetAsync(string key, byte[] value, DistributedCacheEntryOptions options, CancellationToken token = default)
        {
            if (ThrowOnWrite) throw new InvalidOperationException("write failed");
            Store[key] = System.Text.Encoding.UTF8.GetString(value);
            return Task.CompletedTask;
        }
    }
}
