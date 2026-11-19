// Modified for ASP Assistant Arknights on 2026-11-11; see NOTICE.
using ASPAssistant.Core.Models;

namespace ASPAssistant.Core.Services;

/// <summary>
/// Which operators a run's covenant bans remove from the pool. Used by both the ban-screen analysis
/// (干员页的本局不可用) and the planner, so the two always agree.
/// </summary>
public static class CovenantBanRules
{
    /// <summary>
    /// A grey core covenant excludes all its members. Grey additional covenants exclude an
    /// operator when the operator has at least one additional covenant and every one is grey.
    /// </summary>
    public static bool IsExcluded(Operator op, IReadOnlySet<string> bannedCovenants)
        => IsExcluded(op.CoreCovenants, op.AdditionalCovenants, bannedCovenants);

    public static bool IsExcluded(IEnumerable<string> core, IEnumerable<string> additional, IReadOnlySet<string> bannedCovenants)
    {
        if (bannedCovenants.Count == 0) return false;
        if (core.Any(bannedCovenants.Contains)) return true;
        var small = additional.Where(c => !string.IsNullOrWhiteSpace(c)).ToArray();
        return small.Length > 0 && small.All(bannedCovenants.Contains);
    }
}
