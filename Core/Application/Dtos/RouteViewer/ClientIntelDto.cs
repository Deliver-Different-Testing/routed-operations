// Client Intel dialog DTOs. Two shapes:
// - ClientIntelDto: the intel record itself (dangerous-dog flag + notes).
// - ClientIntelImageDto: one image + description; multi-photo carousel
//   returns List<ClientIntelImageDto>.
//
// Photos are base64-serialised byte[] per master 16.9 (five carriers
// across the payload set). React needs a shared img-render helper.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class ClientIntelDto
{
    public int ClientIntelId { get; set; }
    public string? Mobile { get; set; }
    public bool Dog { get; set; }
    public string? Notes { get; set; }
    public bool HasPhoto { get; set; }
}

public class ClientIntelImageDto
{
    /// <summary>Base64-encoded JPG/PNG. React renders as
    /// `data:image/jpeg;base64,...`.</summary>
    public byte[]? Photo { get; set; }

    public string? Description { get; set; }

    /// <summary>S3 object key so the client-side delete path can target
    /// a specific photo without a second lookup.</summary>
    public string? Key { get; set; }
}
