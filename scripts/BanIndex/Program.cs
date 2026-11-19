using System.Text.Encodings.Web;
using System.Text.Json;
using ASPAssistant.Core.Models;
using ASPAssistant.Core.Services;

// The touch UI needs immediate results even while the placement worker is busy.
// Generate every state for each operator's own covenants with the desktop rule.
var directory = args.Single();
var index = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var file in new[] { "operators.json", "custom_operators.json" })
{
    using var data = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, file)));
    foreach (var op in data.RootElement.GetProperty("operators").Deserialize<List<Operator>>()!)
    {
        var bonds = op.CoreCovenants.Concat(op.AdditionalCovenants)
            .Where(n => !string.IsNullOrWhiteSpace(n)).Distinct().ToArray();
        var excluded = new bool[1 << bonds.Length];
        for (var mask = 0; mask < excluded.Length; mask++)
        {
            var selected = bonds.Where((_, i) => (mask & (1 << i)) != 0).ToHashSet();
            excluded[mask] = CovenantBanRules.IsExcluded(op, selected);
        }
        index.Add(op.Name, new { bonds, excluded });
    }
}
var options = new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
File.WriteAllText(Path.Combine(directory, "ban_index.json"), JsonSerializer.Serialize(index, options) + "\n");
