// Thrown by INpScopeGuard when a request targets a row (job / bulk job /
// route / run) that does not belong to the current NP scope. Controllers
// catch this and translate to HTTP 403 Forbidden. Named "Label" for
// historical reasons - the legacy RunViewer surfaced it first from
// LabelService when NP users tried to render labels for another NP's
// bulk jobs. Semantic is generic "cross-scope access denied".

namespace RoutedOperations.Core.Application.Services.Np;

public class NpLabelScopeException : Exception
{
    public NpLabelScopeException() : base("Access denied: row is outside your NP scope.") { }

    public NpLabelScopeException(string message) : base(message) { }

    public NpLabelScopeException(string message, Exception innerException) : base(message, innerException) { }
}
