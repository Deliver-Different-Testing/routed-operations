// Switches for the branch visibility rule. Bound from the "Branches" section of
// appsettings / environment (Branches__JobVisibleViaCourierBranch=true).

namespace RoutedOperations.Core.Application.Services.Branches;

public sealed class BranchVisibilityOptions
{
    public const string SectionName = "Branches";

    /// <summary>
    /// Cross-branch jobs, master spec section 4.1. false (default) = option A:
    /// a job is visible only if its client's branch is one of the user's.
    /// true = option B: also visible if the job's courier's home branch is one
    /// of the user's. Config only, no migration. The rule lives in one place,
    /// BranchPredicates.JobVisible / BranchRowFilter.IsJobVisible.
    /// </summary>
    public bool JobVisibleViaCourierBranch { get; set; }
}
