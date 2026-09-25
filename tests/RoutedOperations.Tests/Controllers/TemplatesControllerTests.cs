using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Dtos.BulkImport.Templates;
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Controllers;

// Covers TemplatesController. Auth policy RouteBuilder.Admin is declarative
// and not exercised. The controller wraps every TemplateService reply in the
// shared HandleBulkResponse (Success=200/else=400). Ownership scoping to
// ContactId is enforced inside the service (covered by TemplateServiceTests).
public class TemplatesControllerTests
{
    private static TemplatesController NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var accessor = ControllerTestHarness.Accessor(contactId: "7");
        var cache = ControllerTestHarness.Cache(accessor);
        var svc = new TemplateService(ControllerTestHarness.Factory(opts), cache);
        var logger = Substitute.For<ILogger<TemplatesController>>();
        var ctl = new TemplatesController(svc, logger);
        ControllerTestHarness.AttachHttpContext(ctl, contactId: "7");
        return ctl;
    }

    [Fact]
    public async Task Get_EmptyStore_ReturnsOkTemplatesResponse()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.Get());
        var resp = Assert.IsType<TemplatesResponse>(ok.Value!);
        Assert.True(resp.Success);
        Assert.Empty(resp.Templates);
    }

    [Fact]
    public async Task Create_InvalidModelState_ReturnsBadRequest()
    {
        var ctl = NewCtl();
        ctl.ModelState.AddModelError("Template", "required");
        var req = new TemplateCreateRequest { Template = null };
        Assert.IsType<BadRequestObjectResult>(await ctl.Create(req));
    }

    [Fact]
    public async Task Create_ValidRequest_ReturnsOkWithCreatedTemplate()
    {
        var ctl = NewCtl();
        var req = new TemplateCreateRequest
        {
            Template = new TemplateCreateDto
            {
                Name = "US Shipments",
                Mappings = new List<TemplateMappingDto>
                {
                    new() { UrgentField = "clientRef", ImportField = "Ref" }
                }
            }
        };
        var ok = Assert.IsType<OkObjectResult>(await ctl.Create(req));
        var resp = Assert.IsType<TemplateResponse>(ok.Value!);
        Assert.True(resp.Success);
        Assert.Equal("US Shipments", resp.Template.Name);
    }

    [Fact]
    public async Task Delete_InvalidModelState_ReturnsBadRequest()
    {
        var ctl = NewCtl();
        ctl.ModelState.AddModelError("Id", "required");
        var req = new IdRequest { Id = null };
        Assert.IsType<BadRequestObjectResult>(await ctl.Delete(req));
    }

    [Fact]
    public async Task Delete_UnknownId_ReturnsBadRequestFromServiceResponse()
    {
        // Service returns Success=false + "Template not found." message which
        // HandleBulkResponse maps to 400 (not 404) - matches the pre-existing
        // BulkImportHyper contract that avoids leaking existence.
        var ctl = NewCtl();
        var req = new IdRequest { Id = 999 };
        Assert.IsType<BadRequestObjectResult>(await ctl.Delete(req));
    }
}
