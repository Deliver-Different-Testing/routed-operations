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
public class TemplateService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    public async Task<TemplatesResponse> Get(Guid messageId, int contactId)
    {
        return new TemplatesResponse(messageId)
        {
            Success = true,
            Templates = await Context.BulkImportTemplates
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

        response.Success = true;
        return response;
    }
}
