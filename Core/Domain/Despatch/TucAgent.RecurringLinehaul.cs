// Partial extension for TucAgent - adds the Association column the Recurring
// Routes Linehaul port surfaces as the picker's "hint" text (e.g. NP name).
// Column pre-exists in the shared Despatch DB (verified 2026-08-12 via MCP).
#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucAgent
{
    public string Association { get; set; }
}
