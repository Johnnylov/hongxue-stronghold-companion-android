// The data record from upstream ShopEconomyReader, used with manually entered shop values.
namespace ASPAssistant.Core.Services;
public sealed record ShopEconomy(int? Round, int? Money, int? UpgradeCost, bool UpgradeMaxed, string? Mode, bool IsPreparation)
{
    public bool HasAny => Round is not null || Money is not null || UpgradeCost is not null || UpgradeMaxed;
}
