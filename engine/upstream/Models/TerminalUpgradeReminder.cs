using System.Text.Json.Serialization;

namespace ASPAssistant.Core.Models;

public sealed record TerminalUpgradeReminder(
    [property: JsonPropertyName("targetLevel")] int TargetLevel,
    [property: JsonPropertyName("startRound")] int StartRound,
    [property: JsonPropertyName("endRound")] int EndRound,
    [property: JsonPropertyName("note")] string Note = "")
{
    public const int MinRound = 2;
    public const int MaxRound = 14;

    [JsonIgnore]
    public string RoundText => StartRound == EndRound ? $"第{StartRound}回合" : $"第{StartRound}–{EndRound}回合";

    public static string DataError(IReadOnlyList<TerminalUpgradeReminder>? reminders)
    {
        if (reminders is null) return "升本计划不能为空，请删除无效配置后重新填写";
        var levels = new HashSet<int>();
        foreach (var reminder in reminders)
        {
            if (reminder is null || reminder.TargetLevel is < 2 or > 6) return "升本目标等级须为2–6级";
            if (!levels.Add(reminder.TargetLevel)) return $"升至{reminder.TargetLevel}级只能设置一条提醒";
            if (reminder.Note is null || reminder.Note.Length > 80) return "升本备注最多80字";
        }
        return "";
    }

    public static string ValidationError(IReadOnlyList<TerminalUpgradeReminder>? reminders)
    {
        string error = DataError(reminders);
        if (error.Length > 0) return error;
        TerminalUpgradeReminder? previous = null;
        foreach (var reminder in reminders!.OrderBy(r => r.TargetLevel))
        {
            if (reminder.StartRound is < MinRound or > MaxRound || reminder.EndRound is < MinRound or > MaxRound)
                return "升本回合只能选择2–14回合";
            if (reminder.StartRound > reminder.EndRound) return "升本开始回合不能晚于结束回合";
            if (previous is not null && (reminder.StartRound < previous.StartRound || reminder.EndRound < previous.EndRound))
                return $"{reminder.TargetLevel}级的开始、结束回合不能早于{previous.TargetLevel}级的对应回合";
            previous = reminder;
        }
        return "";
    }
}

public enum UpgradeReminderStatus { Waiting, Upcoming, Due, LastRound, Overdue, Completed, Ignored }

public sealed record UpgradeReminderDisplay(UpgradeReminderStatus Status, TerminalUpgradeReminder? Reminder,
    string Title, string RangeText, string Detail);

public sealed record UpgradeReminderProgress(string LineupId, int TargetLevel,
    bool Entered = false, bool Ended = false, bool Ignored = false);
