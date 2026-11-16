using System.Globalization;

// #319. One quantity rule for every bulk path: the New Import validator and the
// Staff Import row loop. A blank cell means 1, which is what both paths already
// did. Anything else must be a whole number from 1 to 32767 (tblBulkJob.Qty is
// a smallint). Before this, 0 booked a job priced at 0 with no items, a negative
// threw in the rating service, 2.7 became 2 and "abc" became a silent 1.
// The wizard runs the same rule client side (wizardState.ts quantityCellProblem).
namespace RoutedOperations.Core.Application.Services.BulkImport;

public static class BulkQuantity
{
    public const short Min = 1;
    public const short Max = short.MaxValue;

    public const string RangeMessage = "Quantity must be a whole number from 1 to 32767.";

    /// <summary>
    /// Reads a spreadsheet cell. True with a null quantity when the cell is
    /// blank (the job books as 1). False when the cell has something in it that
    /// is not a whole number from 1 to 32767.
    /// </summary>
    public static bool TryParseCell(string? cell, out short? quantity)
    {
        quantity = null;
        if (string.IsNullOrWhiteSpace(cell)) return true;
        if (!int.TryParse(cell.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return false;
        if (n < Min || n > Max) return false;
        quantity = (short)n;
        return true;
    }
}
