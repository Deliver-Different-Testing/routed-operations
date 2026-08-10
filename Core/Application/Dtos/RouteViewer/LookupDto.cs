// Filter-dropdown DTOs. Six legacy VMs used [JsonPropertyName("id")] +
// [JsonPropertyName("label")] to remap PascalCase to lowercase for
// Select2 / md-select payload compat (master Section 16.8 casing
// contract). Route Viewer's React port consumes the same lowercase keys;
// these DTOs use lowercase property names so the Newtonsoft camelCase
// policy emits them verbatim.
//
// One DTO covers Client / Speed / Region / TopUpService / Suburb - all
// have the same {id, label} shape. Legacy split them into six VMs; we
// unify.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

/// <summary>
/// Generic {id, label} lookup row for filter dropdowns. Lowercase
/// property names by convention so the emitted JSON matches Select2 /
/// md-select expectations without needing per-DTO JsonPropertyName
/// attributes.
/// </summary>
public class LookupDto
{
    public int id { get; set; }
    public string? label { get; set; }
}

/// <summary>
/// Suburb-typeahead row. Adds `alias` because tucSuburb has a Google
/// alias column used for fuzzy address match on the GPS form.
/// </summary>
public class SuburbLookupDto
{
    public int id { get; set; }
    public string? label { get; set; }
    public string? alias { get; set; }
}
