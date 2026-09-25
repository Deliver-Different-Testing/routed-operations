using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Dtos.BulkImport.Templates;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

// Covers Get / Create / Delete on the per-contact template store. Focus is
// on the ownership filter (ContactId), cache invalidation on write, and
// the "template not found" guard on Delete.
public class TemplateServiceTests
{
    private static TemplateService NewSvc(out DynamicDespatchDbContext seed)
    {
        var opts = BulkImportTestHarness.NewOptions();
        seed = BulkImportTestHarness.Context(opts);
        var accessor = BulkImportTestHarness.Accessor();
        var cache = BulkImportTestHarness.Cache(accessor);
        return new TemplateService(BulkImportTestHarness.Factory(opts), cache);
    }

    [Fact]
    public async Task Get_EmptyDb_ReturnsEmptyList()
    {
        var svc = NewSvc(out _);

        var resp = await svc.Get(Guid.NewGuid(), contactId: 1);

        Assert.True(resp.Success);
        Assert.Empty(resp.Templates);
    }

    [Fact]
    public async Task Get_ScopesToContactAndOrdersByName()
    {
        var svc = NewSvc(out var seed);
        seed.BulkImportTemplates.AddRange(
            new BulkImportTemplate { Id = 1, ContactId = 1, Name = "Zeta", Created = DateTime.Now },
            new BulkImportTemplate { Id = 2, ContactId = 1, Name = "Alpha", Created = DateTime.Now },
            new BulkImportTemplate { Id = 3, ContactId = 2, Name = "OtherContact", Created = DateTime.Now });
        await seed.SaveChangesAsync();

        var resp = await svc.Get(Guid.NewGuid(), contactId: 1);

        Assert.Equal(new[] { "Alpha", "Zeta" }, resp.Templates.Select(t => t.Name).ToArray());
    }

    [Fact]
    public async Task Get_ProjectsMappings()
    {
        var svc = NewSvc(out var seed);
        seed.BulkImportTemplates.Add(new BulkImportTemplate
        {
            Id = 1,
            ContactId = 5,
            Name = "T",
            Created = DateTime.Now,
            BulkImportTemplateMappings = new List<BulkImportTemplateMapping>
            {
                new() { Id = 10, TemplateId = 1, UrgentField = "clientRef", ImportField = "Ref", Created = DateTime.Now },
                new() { Id = 11, TemplateId = 1, UrgentField = "toAddress", ImportField = "Ship-To", Created = DateTime.Now }
            }
        });
        await seed.SaveChangesAsync();

        var resp = await svc.Get(Guid.NewGuid(), contactId: 5);

        var tpl = resp.Templates.Single();
        Assert.Equal(2, tpl.Mappings.Count());
        Assert.Contains(tpl.Mappings, m => m.UrgentField == "clientRef" && m.ImportField == "Ref");
    }

    [Fact]
    public async Task Get_UsesTenantScopedCache_SecondCallHitsCache()
    {
        // With the real MemoryCache seeded once, mutating the DB after the
        // first call must NOT surface in a second Get() for the same key.
        var svc = NewSvc(out var seed);
        var mid = Guid.NewGuid();
        var first = await svc.Get(mid, contactId: 7);
        Assert.Empty(first.Templates);

        // Add a template AFTER the cache warmed with an empty list.
        seed.BulkImportTemplates.Add(new BulkImportTemplate { Id = 100, ContactId = 7, Name = "Post", Created = DateTime.Now });
        await seed.SaveChangesAsync();

        var second = await svc.Get(mid, contactId: 7);
        Assert.Empty(second.Templates); // still empty -> served from cache
    }

    [Fact]
    public async Task Create_PersistsTemplateAndMappings()
    {
        var opts = BulkImportTestHarness.NewOptions();
        var accessor = BulkImportTestHarness.Accessor();
        var cache = BulkImportTestHarness.Cache(accessor);
        var svc = new TemplateService(BulkImportTestHarness.Factory(opts), cache);

        var req = new TemplateCreateRequest
        {
            Template = new TemplateCreateDto
            {
                Name = "  My Template  ",
                Mappings = new[]
                {
                    new TemplateMappingDto { UrgentField = "clientRef", ImportField = "Ref" },
                    new TemplateMappingDto { UrgentField = "toAddress", ImportField = "Ship-To" }
                }
            }
        };

        var resp = await svc.Create(contactId: 9, req);

        Assert.True(resp.Success);
        Assert.Equal("My Template", resp.Template.Name); // trimmed
        Assert.Equal(2, resp.Template.Mappings.Count());

        using var check = BulkImportTestHarness.Context(opts);
        var stored = check.BulkImportTemplates.Include(t => t.BulkImportTemplateMappings).Single();
        Assert.Equal(9, stored.ContactId);
        Assert.Equal("My Template", stored.Name);
        Assert.Equal(2, stored.BulkImportTemplateMappings.Count);
    }

    [Fact]
    public async Task Create_InvalidatesCacheSoNextGetSeesNewRow()
    {
        var svc = NewSvc(out _);
        var mid = Guid.NewGuid();
        var before = await svc.Get(mid, contactId: 3);
        Assert.Empty(before.Templates);

        await svc.Create(contactId: 3, new TemplateCreateRequest
        {
            Template = new TemplateCreateDto
            {
                Name = "Fresh",
                Mappings = new[] { new TemplateMappingDto { UrgentField = "a", ImportField = "b" } }
            }
        });

        var after = await svc.Get(mid, contactId: 3);
        Assert.Single(after.Templates);
        Assert.Equal("Fresh", after.Templates.Single().Name);
    }

    [Fact]
    public async Task Delete_UnknownTemplate_ReturnsNotFoundMessage()
    {
        var svc = NewSvc(out _);
        var resp = await svc.Delete(contactId: 1, new IdRequest { Id = 999 });

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Template not found.");
    }

    [Fact]
    public async Task Delete_TemplateOwnedByDifferentContact_ReturnsNotFound()
    {
        var svc = NewSvc(out var seed);
        seed.BulkImportTemplates.Add(new BulkImportTemplate { Id = 42, ContactId = 100, Name = "Theirs", Created = DateTime.Now });
        await seed.SaveChangesAsync();

        var resp = await svc.Delete(contactId: 999, new IdRequest { Id = 42 });

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Template not found.");
    }

    [Fact]
    public async Task Delete_OwnedTemplate_RemovesRowAndMappings()
    {
        var opts = BulkImportTestHarness.NewOptions();
        var accessor = BulkImportTestHarness.Accessor();
        var cache = BulkImportTestHarness.Cache(accessor);
        var svc = new TemplateService(BulkImportTestHarness.Factory(opts), cache);

        using (var seed = BulkImportTestHarness.Context(opts))
        {
            seed.BulkImportTemplates.Add(new BulkImportTemplate
            {
                Id = 5,
                ContactId = 1,
                Name = "Doomed",
                Created = DateTime.Now,
                BulkImportTemplateMappings = new List<BulkImportTemplateMapping>
                {
                    new() { Id = 20, TemplateId = 5, UrgentField = "a", ImportField = "b", Created = DateTime.Now }
                }
            });
            await seed.SaveChangesAsync();
        }

        var resp = await svc.Delete(contactId: 1, new IdRequest { Id = 5 });

        Assert.True(resp.Success);
        using var check = BulkImportTestHarness.Context(opts);
        Assert.Empty(check.BulkImportTemplates);
        Assert.Empty(check.BulkImportTemplateMappings);
    }

    [Fact]
    public async Task Delete_InvalidatesCache()
    {
        var opts = BulkImportTestHarness.NewOptions();
        var accessor = BulkImportTestHarness.Accessor();
        var cache = BulkImportTestHarness.Cache(accessor);
        var svc = new TemplateService(BulkImportTestHarness.Factory(opts), cache);

        using (var seed = BulkImportTestHarness.Context(opts))
        {
            seed.BulkImportTemplates.Add(new BulkImportTemplate { Id = 7, ContactId = 1, Name = "Cached", Created = DateTime.Now });
            await seed.SaveChangesAsync();
        }

        var mid = Guid.NewGuid();
        var warm = await svc.Get(mid, contactId: 1);
        Assert.Single(warm.Templates);

        await svc.Delete(contactId: 1, new IdRequest { Id = 7 });

        var after = await svc.Get(mid, contactId: 1);
        Assert.Empty(after.Templates); // cache invalidated then reloaded
    }
}
