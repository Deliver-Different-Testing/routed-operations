using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.Common;
using Serilog;

namespace RoutedOperations.API.Controllers;

public abstract class BaseController : ControllerBase
{
    protected IActionResult HandleInvalidModelState(Guid messageId)
    {
        var response = new BaseResponse(messageId);
        var messages = ModelState.Values
            .SelectMany(x => x.Errors.Select(e => new MessageDto { Message = e.ErrorMessage }));
        response.Messages.AddRange(messages);

        Log.Warning("Response ({MessageId}): {Response}", response.MessageId, JsonConvert.SerializeObject(response));
        return BadRequest(response);
    }

    protected IActionResult HandleResponse(BaseResponse response)
    {
        Log.Information("Response ({MessageId}): {Response}", response.MessageId, JsonConvert.SerializeObject(response));
        return response.Success ? Ok(response) : BadRequest(response);
    }

    protected IActionResult HandleResponseNoLogging(BaseResponse response)
    {
        return response.Success ? Ok(response) : BadRequest(response);
    }
}
