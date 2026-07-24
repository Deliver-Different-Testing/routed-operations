using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Utilities;

// Ported from BulkImportHyper's ResponseUtility. Sits alongside the
// RoutedOperations-native ResponseUtility (which targets a different
// BaseResponse under Dtos.Common) so the two shapes can coexist without
// having to unify the response class hierarchies mid-port.
public static class BulkImportResponseUtility
{
    public static TBaseResponse AddMessageAndReturnResponse<TBaseResponse>(TBaseResponse response, string message)
        where TBaseResponse : BaseResponse
    {
        response.Messages.Add(new MessageDto() { Message = message });
        return response;
    }
}
