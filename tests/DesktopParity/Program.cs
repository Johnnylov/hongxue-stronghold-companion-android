using System.Text.Json;
using ASPAssistant.Core.Data;
using ASPAssistant.Core.Models;
using ASPAssistant.Core.Services;

if (args.Length != 2) throw new ArgumentException("Pass the desktop app/data directory and the output JSON path.");
var store = new JsonDataStore(args[0]);
var operators = (await store.LoadOperatorsAsync()).Concat(await store.LoadCustomOperatorsAsync()).ToDictionary(o=>o.Name);
var (covenants, _) = await store.LoadCovenantsAsync();
var maps = await GarrisonBoardStore.LoadAsync(args[0]) ?? throw new InvalidDataException("Missing map data");
var planner = new PlacementPlanner(operators,covenants);
var catalogue = new[] {
    ("desert_crates", new[] {"深靛","瑰盐","蓝毒"}),
    ("desert_cactus", new[] {"砾","初雪","伊桑","华法琳","灵知","耶拉","角峰","锏"})
};
var output = new List<object>();
foreach(var (mapId,names) in catalogue) {
    var map=maps.Find(mapId)!;
    var pool=names.Select(n=>new PlacementCandidate(n,false)).ToList();
    var opt=new PlacementOptions {FieldCount=8,Mode=PlacementMode.Balanced};
    var reference=planner.Plan(map,pool,opt);
    var layout=reference.Placed.Select(p=>new {p.Key,p.Cell,p.Facing}).ToArray();
    for(int i=0;i<3;i++){
        var repeat=planner.Plan(map,pool,opt);
        if(!layout.SequenceEqual(repeat.Placed.Select(p=>new {p.Key,p.Cell,p.Facing})))throw new Exception("Desktop output changed");
    }
    output.Add(new {mapId,names,layout,reference.Total,checks=reference.Checks.Select(c=>c.Text)});
}
await File.WriteAllTextAsync(args[1],JsonSerializer.Serialize(output,new JsonSerializerOptions(JsonSerializerDefaults.Web){WriteIndented=true}));

// Cover route geometry, duplicate copies, pins, elite effects and the bench on the shipped maps.
var cases = new List<object>();
string[][] teams = [
    ["深靛", "瑰盐", "蓝毒"],
    ["砾", "初雪", "伊桑", "华法琳", "灵知", "耶拉", "角峰", "锏"],
    ["角峰", "涤火杰西卡", "Mon3tr", "阿米娅", "塞雷娅", "浊心斯卡蒂", "凛御银灰", "灵知", "初雪", "砾"],
    ["帕拉斯", "伊桑", "铃兰", "机械师", "歌蕾蒂娅", "罗比菈塔", "旅骨", "青枳", "佩佩"]
];
for (int index = 0; index < maps.Maps.Count; index++)
{
    var map = maps.Maps[index];
    var names = teams[index % teams.Length].Where(planner.CanPlace).ToList();
    var pool = names.Select((n, i) => new PlacementCandidate(n, index > 1 && i % 3 == 0)).ToList();
    if (index > 1) pool.Add(new PlacementCandidate(names[0], true, 1));
    var people = index % 2 == 0 ? 8 : 9;
    var mode = (PlacementMode)(index % 3);
    var pins = new Dictionary<string, PlacementPin>();
    if (index > 1 && index % 2 == 0)
        pins[names[0]] = new(map.AllCells().First(x => x.Type == BoardCellType.Ground).Cell, Facing.Up);
    var options = new PlacementOptions { FieldCount = people, Mode = mode, Pins = pins };
    var plan = planner.Plan(map, pool, options);
    cases.Add(new {
        req = new { map = map.Id, pool, people, mode, pins },
        total = plan.Total, combat = plan.Combat, stacking = plan.Stacking,
        layout = plan.Placed, checks = plan.Checks, bench = plan.Bench
    });
}
var boardPath = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[1]))!, "boards.json");
await File.WriteAllTextAsync(boardPath, JsonSerializer.Serialize(cases, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
