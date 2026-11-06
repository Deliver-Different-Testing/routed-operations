using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.BulkImport;

// One place that news up BulkImportServiceV2 for the truck and P2P guard tests.
internal static class TruckTestFakes
{
    internal static BulkImportServiceV2 NewService(
        IDbContextFactory<DynamicDespatchDbContext> factory,
        IHttpClientFactory httpClientFactory,
        IHttpContextAccessor accessor,
        AddressService address,
        IBulkClientScope scope,
        IBulkTruckPreflight? preflight = null,
        IBulkTruckInserter? inserter = null,
        IBulkP2PItemInserter? itemInserter = null) =>
        new(factory, httpClientFactory, accessor, address, scope,
            preflight ?? Substitute.For<IBulkTruckPreflight>(), inserter ?? Substitute.For<IBulkTruckInserter>(),
            itemInserter ?? Substitute.For<IBulkP2PItemInserter>());
}
