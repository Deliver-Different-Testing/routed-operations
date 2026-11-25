using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.SuburbAlias;

// #333: one remembered suburb fix. RawSuburb / RawPostCode are the
// normalised sheet values; SuburbName / PostCode are the tucSuburb it maps to.
public class SuburbAliasDto
{
    public int Id { get; set; }
    public int? ClientId { get; set; }
    public string RawSuburb { get; set; }
    public string RawPostCode { get; set; }
    public int SuburbId { get; set; }
    public string SuburbName { get; set; }
    public string PostCode { get; set; }
}

public class SuburbAliasesResponse : BaseResponse
{
    public SuburbAliasesResponse(Guid messageId) : base(messageId) { }

    // The client's own rows first, then the tenant-wide (ClientId NULL) rows.
    public List<SuburbAliasDto> Aliases { get; set; } = new List<SuburbAliasDto>();
}

public class SuburbAliasResponse : BaseResponse
{
    public SuburbAliasResponse(Guid messageId) : base(messageId) { }

    public SuburbAliasDto Alias { get; set; }
}

public class RememberSuburbAliasRequest : BaseRequest
{
    public int ClientId { get; set; }
    public string RawSuburb { get; set; }
    public string RawPostCode { get; set; }
    public int SuburbId { get; set; }
}
