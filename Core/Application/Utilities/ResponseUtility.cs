using RoutedOperations.Core.Application.Dtos.Common;

namespace RoutedOperations.Core.Application.Utilities;

public static class ResponseUtility
{
    public static BaseResponse AddMessageAndReturnResponse(BaseResponse response, string message)
    {
        response.Success = false;
        response.Messages.Add(new MessageDto { Message = message });
        return response;
    }

    public static BaseResponse Success(BaseResponse response, object? data = null)
    {
        response.Success = true;
        response.Data = data;
        return response;
    }
}
