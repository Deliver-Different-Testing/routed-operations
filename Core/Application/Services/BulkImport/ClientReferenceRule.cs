// The client reference check the booking procs run, for the bulk paths that reach
// no such check. Same order, wording and CRLF join as WS_stpJob_Insert 748-793 and
// DD_stpJob_InsertExcelerator 431-475, whose bodies are identical here. INT_stpJob_BulkInsert
// and UTL_stpJob_Truck_Insert check nothing, so without this NZ books the row as is.
namespace RoutedOperations.Core.Application.Services.BulkImport;

public static class ClientReferenceRule
{
    // The proc joins its errors with CHAR(13) + CHAR(10).
    public const string Separator = "\r\n";

    // LEN() ignores trailing spaces only, so a tab is not blank to the proc.
    public static bool IsBlank(string? value) => string.IsNullOrEmpty(value?.TrimEnd(' '));

    /// <summary>
    /// Null when the row passes. aInList and bInList come from SQL, so the tenant's
    /// collation decides the match. They are true when the client has no list. A
    /// blank value on a list client comes back false, and is refused even when the
    /// reference is optional, because the proc's list check ignores Mandatory.
    /// </summary>
    public static string? Refusal(TruckClientFacts client, string? referenceA, string? referenceB, bool aInList, bool bInList)
    {
        var errors = new List<string>();
        if (client.ReferenceAMandatory && IsBlank(referenceA)) errors.Add(Required("A", client.ReferenceAMessage));
        if (!aInList) errors.Add(NotInList("A", referenceA));
        if (client.ReferenceBMandatory && IsBlank(referenceB)) errors.Add(Required("B", client.ReferenceBMessage));
        if (!bInList) errors.Add(NotInList("B", referenceB));
        return errors.Count == 0 ? null : string.Join(Separator, errors);
    }

    public static string? MandatoryRefusal(TruckClientFacts client, string? referenceA, string? referenceB) =>
        Refusal(client, referenceA, referenceB, aInList: true, bInList: true);

    public static string? ListRefusal(string? referenceA, string? referenceB, bool aInList, bool bInList)
    {
        var errors = new List<string>();
        if (!aInList) errors.Add(NotInList("A", referenceA));
        if (!bInList) errors.Add(NotInList("B", referenceB));
        return errors.Count == 0 ? null : string.Join(Separator, errors);
    }

    private static string Required(string letter, string? message) => $"Require \"Reference {letter}\" - \"{message}\"";

    private static string NotInList(string letter, string? value) => $"\"Reference {letter}\" - \"{value}\" not in defined list.";
}
