using FluentValidation.TestHelper;
using RoutedOperations.Core.Application.Dtos.BulkImport.Templates;
using RoutedOperations.Core.Application.Validators;

namespace RoutedOperations.Tests.Validators;

public class TemplateCreateRequestValidatorTests
{
    private readonly TemplateCreateRequestValidator _sut = new();

    [Fact]
    public void HappyPath_Passes()
    {
        var req = new TemplateCreateRequest
        {
            Template = new TemplateCreateDto
            {
                Name = "US import template",
                Mappings = new[]
                {
                    new TemplateMappingDto { UrgentField = "clientRef", ImportField = "Reference" },
                    new TemplateMappingDto { UrgentField = "toAddress", ImportField = "Ship To Address" },
                },
            },
        };
        var result = _sut.TestValidate(req);
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Template_Missing_Fails()
    {
        var req = new TemplateCreateRequest { Template = null! };
        var result = _sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.Template);
    }

    [Fact]
    public void TemplateName_Empty_Fails()
    {
        var req = new TemplateCreateRequest
        {
            Template = new TemplateCreateDto
            {
                Name = string.Empty,
                Mappings = new[] { new TemplateMappingDto { UrgentField = "a", ImportField = "b" } },
            },
        };
        var result = _sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.Template.Name);
    }

    [Fact]
    public void TemplateName_TooLong_Fails()
    {
        var req = new TemplateCreateRequest
        {
            Template = new TemplateCreateDto
            {
                Name = new string('x', 51),
                Mappings = new[] { new TemplateMappingDto { UrgentField = "a", ImportField = "b" } },
            },
        };
        var result = _sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.Template.Name);
    }

    [Fact]
    public void EmptyMappings_Fails()
    {
        var req = new TemplateCreateRequest
        {
            Template = new TemplateCreateDto
            {
                Name = "Template",
                Mappings = Array.Empty<TemplateMappingDto>(),
            },
        };
        var result = _sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor(x => x.Template.Mappings);
    }

    [Fact]
    public void MappingWithEmptyUrgentField_Fails()
    {
        var req = new TemplateCreateRequest
        {
            Template = new TemplateCreateDto
            {
                Name = "Template",
                Mappings = new[] { new TemplateMappingDto { UrgentField = string.Empty, ImportField = "col" } },
            },
        };
        var result = _sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Template.Mappings[0].UrgentField");
    }

    [Fact]
    public void MappingWithEmptyImportField_Fails()
    {
        var req = new TemplateCreateRequest
        {
            Template = new TemplateCreateDto
            {
                Name = "Template",
                Mappings = new[] { new TemplateMappingDto { UrgentField = "clientRef", ImportField = string.Empty } },
            },
        };
        var result = _sut.TestValidate(req);
        result.ShouldHaveValidationErrorFor("Template.Mappings[0].ImportField");
    }
}
