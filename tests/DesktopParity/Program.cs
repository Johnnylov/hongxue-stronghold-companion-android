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
