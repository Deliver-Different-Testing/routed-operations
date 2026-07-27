using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Dtos.BulkImport.Templates;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.BulkImport;

// Ported from BulkImportHyper. Manages the per-contact CSV column-mapping
// templates that the Bulk Import wizard uses to remember which spreadsheet
// column corresponds to which Urgent field. Ownership is enforced by the
// ContactId filter on every read/write so operators can't see or delete
// another contact's templates.
public class TemplateService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    TenantScopedCache cache)
    : BaseService(contextFactory)
{
    // 1-minute TTL - operators create/edit templates mid-session; short
    // ceiling means the cache still absorbs the wizard's per-step re-fetches
    // (Step 1 -> back to Step 1 etc.) without holding stale data long enough
    // to matter if invalidation misses.
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(1);

    private static string CacheKey(int contactId) => $"templates:contact:{contactId}";

    public Task<TemplatesResponse> Get(Guid messageId, int contactId) =>
        cache.GetOrSetAsync(CacheKey(contactId), CacheTtl, () => LoadAsync(messageId, contactId));

    private async Task<TemplatesResponse> LoadAsync(Guid messageId, int contactId)
    {
        return new TemplatesResponse(messageId)
        {
            Success = true,
            Templates = await Context.BulkImportTemplates
                .AsNoTracking()
                .Where(t => t.ContactId == contactId)
                .Select(t => new TemplateDto()
                {
                    Id = t.Id,
                    Name = t.Name,
                    Mappings = t.BulkImportTemplateMappings.Select(m => new TemplateMappingDto()
                    {
                        UrgentField = m.UrgentField,
                        ImportField = m.ImportField
                    })
                })
                .OrderBy(t => t.Name)
                .ToListAsync()
        };
    }

    public async Task<TemplateResponse> Create(int contactId, TemplateCreateRequest request)
    {
        TemplateResponse response = new TemplateResponse(request.MessageId);

        BulkImportTemplate template = new BulkImportTemplate()
        {
            Created = DateTime.Now,
            ContactId = contactId,
            Name = request.Template.Name.Trim(),
            BulkImportTemplateMappings = request.Template.Mappings.Select(m => new BulkImportTemplateMapping()
                {
                    Created = DateTime.Now,
                    UrgentField = m.UrgentField,
                    ImportField = m.ImportField
                })
                .ToList()
        };

        Context.Add(template);
        await Context.SaveChangesAsync();
        cache.Invalidate(CacheKey(contactId));

        response.Template = new TemplateDto()
        {
            Id = template.Id,
            Name = template.Name,
            Mappings = template.BulkImportTemplateMappings.Select(m => new TemplateMappingDto()
            {
                UrgentField = m.UrgentField,
                ImportField = m.ImportField
            })
        };

        response.Success = true;
        return response;
    }

    public async Task<BaseResponse> Delete(int contactId, IdRequest request)
    {
        var template = await Context.BulkImportTemplates
                .Include(t => t.BulkImportTemplateMappings)
                .FirstOrDefaultAsync(t => t.Id == request.Id && t.ContactId == contactId);

        var response = new BaseResponse(request.MessageId);

        if (template == null)
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Template not found.");

        Context.BulkImportTemplateMappings.RemoveRange(template.BulkImportTemplateMappings);
        Context.BulkImportTemplates.Remove(template);

        await Context.SaveChangesAsync();
        cache.Invalidate(CacheKey(contactId));

        response.Success = true;
        return response;
    }
}
