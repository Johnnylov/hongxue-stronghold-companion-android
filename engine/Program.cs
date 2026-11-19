using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using ASPAssistant.Core.Data;
using ASPAssistant.Core.Models;
using ASPAssistant.Core.Services;

public partial class TabletEngine
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static List<Operator> ops = [];
    private static List<CovenantInfo> bonds = [];
    private static GarrisonBoardData boards = null!;
    private static CovenantCalculator calculator = null!;
    private static PlacementPlanner placement = null!;
    private static AutoPlanResult? lastAuto;
    private static List<PlannedLineup> lastPlans = [];
    public static void Main() { }

    [JSImport("globalThis.hongxuePlacementProgress")]
    private static partial void PlacementProgress(int step, int total);

    [JSExport]
    public static async Task<string> Initialize(string files)
    {
        var data = JsonSerializer.Deserialize<Dictionary<string,string>>(files)!;
        const string path = "/tabledata";
        Directory.CreateDirectory(path);
        foreach (var (name, content) in data) File.WriteAllText(Path.Combine(path, Path.GetFileName(name) + ".json"), content);
        var store = new JsonDataStore(path);
        ops = [.. await store.LoadOperatorsAsync(), .. await store.LoadCustomOperatorsAsync()];
        var raw = await store.LoadCovenantsAsync();
        bonds = raw.Covenants;
        calculator = new CovenantCalculator(ops,bonds,raw.JobChangeEquipmentToCovenant);
        boards = GarrisonBoardStore.Parse(JsonDocument.Parse(data["garrison_maps"]).RootElement,null);
        placement = new PlacementPlanner(ops.ToDictionary(o => o.Name),bonds);
        return "ready";
    }

    public sealed class Request
    {
        public string Map { get; set; } = "";
        public List<PlacementCandidate> Pool { get; set; } = [];
        public Dictionary<string,PlacementPin> Pins { get; set; } = [];
        public Dictionary<string,PlacementPin> Cells { get; set; } = [];
        public int Mode { get; set; } = 1;
        public int People { get; set; } = 8;
        public int Strategy { get; set; }
        public bool MechElite { get; set; }
        public HashSet<string> Banned { get; set; } = [];
        public HashSet<string> BannedBonds { get; set; } = [];
        public HashSet<string> Locked { get; set; } = [];
        public HashSet<string> Custom { get; set; } = [];
        public Dictionary<string,int> Goals { get; set; } = [];
        public int Transforms { get; set; }
        public int Index { get; set; }
        public int Style { get; set; }
        public int Terminal { get; set; } = 1;
        public int? Money { get; set; }
        public int? Round { get; set; }
        public int? Upgrade { get; set; }
        public HashSet<string> Owned { get; set; } = [];
        public Lineup Team { get; set; } = new();
        public AutoPlanCandidate? Candidate { get; set; }
        public PlannedRoute? SavedRoute { get; set; }
    }

    [JSExport]
    public static string Run(string action, string json)
    {
        var r = JsonSerializer.Deserialize<Request>(json,Json)!;
        if ((action is "placement" or "evaluate") && (r.Banned.Count > 0 || r.BannedBonds.Count > 0))
        {
            var excluded = ops.Where(op => CovenantBanRules.IsExcluded(op, r.BannedBonds))
                .Select(op => op.Name).ToHashSet();
            r.Pool.RemoveAll(candidate => r.Banned.Contains(candidate.Name) || excluded.Contains(candidate.Name));
        }
        foreach(var op in ops.Where(o=>o.IsCustom)) op.IsSelectedCustom=r.Custom.Contains(op.Name);
        object result = action switch
        {
            "placement" or "evaluate" => Place(action,r),
            "stats" => calculator.Compute(r.Team),
            "recommend" => LineupTargets.Recommend(r.Team,calculator,n=>Unavailable(n,r),r.BannedBonds),
            "repair" => Repair(r),
            _ => Plan(action,r)
        };
        return JsonSerializer.Serialize(result,Json);
    }

    private static bool Unavailable(string name, Request r)
    {
        var op=ops.FirstOrDefault(o=>o.Name==name);
        return op is null || !op.IsAvailableForSelection || r.Banned.Contains(name) || CovenantBanRules.IsExcluded(op,r.BannedBonds);
    }

    private static object Repair(Request r)
    {
        var repairer=new LineupStageRepairer(ops,calculator);
        var source=r.Team;
        Lineup Copy(Lineup t)=>JsonSerializer.Deserialize<Lineup>(JsonSerializer.Serialize(t,Json),Json)!;
        var probe=Copy(source);
        probe.EditorStages=[new(){Id="probe",Name="成型候选",Slots=probe.Slots},new(){Id="final",Name="成型阵容",IsFinal=true,Slots=probe.Slots}];
        var retained=Copy(probe);
        retained.Slots=retained.Slots.Where(s=>!Unavailable(s.OperatorName,r)).ToList();
        var first=repairer.Repair(probe,retained,r.Banned,r.BannedBonds);
        var final=Copy(source);
        final.Slots=first.Lineup.EditorStages![0].Slots;
        var preview=repairer.Repair(source,final,r.Banned,r.BannedBonds);
        return new {preview.Lineup,preview.Stages,CanSave=preview.CanSave && first.CanSave};
    }

    private static object Place(string action, Request r)
    {
        var map=boards.Find(r.Map) ?? throw new ArgumentException("地图不存在");
        // Match the desktop DeployView.Options; use the upstream seed, restarts and search budget.
        var options = new PlacementOptions { FieldCount=r.People, Mode=(PlacementMode)r.Mode, Pins=r.Pins };
        var plan=action=="placement" ? placement.Plan(map,r.Pool,options,progress: PlacementProgress) :
            placement.Evaluate(map,r.Pool,r.Cells.ToDictionary(k=>k.Key,v=>(v.Value.Cell,v.Value.Facing)),options);
        return new {plan.Placed,plan.Bench,plan.ActiveCovenants,plan.Checks,plan.Combat,plan.Stacking,plan.Total};
    }

    private static object Plan(string action, Request r)
    {
        var planner=new LineupPlanner(ops,bonds);
        var routePlanner=new LineupRoutePlanner(ops,bonds);
        var auto=new AutoPlanner(planner,routePlanner,ops);
        var availableLocks=ops.Where(o=>r.Locked.Contains(o.Name) && !r.Banned.Contains(o.Name)
            && !planner.IsExcludedByBans(o,r.BannedBonds)).Select(o=>o.Name).ToHashSet();
        var autoReq=new AutoPlanRequest {BannedOperators=r.Banned,BannedCovenants=r.BannedBonds,LockedOperators=availableLocks,
            TransformAllowed=planner.DefaultTransformAllowed(r.BannedBonds),People=r.People,Strategy=(PlannerStrategy)r.Strategy,MechElite=r.MechElite};
        if(action=="auto") { lastAuto=auto.Plan(autoReq); return lastAuto; }
        if(action=="advice")
        {
            var economy=new ShopEconomy(r.Round,r.Money,r.Upgrade,r.Terminal>=6,null,true);
            return auto.Advise(r.SavedRoute!,(AutoPlanStyle)r.Style,r.Candidate!,new AutoPlanRunState(r.Terminal,economy,r.Owned));
        }
        if(action=="autoRoute")
        {
            var candidate=lastAuto!.Candidates[r.Index];
            var route=auto.PlanRoute(candidate,(AutoPlanStyle)r.Style,autoReq);
            var economy=new ShopEconomy(r.Round,r.Money,r.Upgrade,r.Terminal>=6,null,true);
            var advice=auto.Advise(route.Route,(AutoPlanStyle)r.Style,candidate,new AutoPlanRunState(r.Terminal,economy,r.Owned));
            return new {route.Route,Advice=advice,candidate.MainCovenant,candidate.StyleReason};
        }
        if(action=="route")
        {
            var final=lastPlans[r.Index];
            return routePlanner.Plan(new RouteRequest {Final=final,Goals=final.Goals,BannedCovenants=r.BannedBonds,BannedOperators=r.Banned});
        }
        var goals=bonds.Where(c=>r.Goals.ContainsKey(c.Name)).Select(c=>LineupPlanner.CreateGoal(c,r.Goals[c.Name])).ToList();
        var request=new PlannerRequest {Goals=goals,LockedOperators=availableLocks,BannedOperators=r.Banned,BannedCovenants=r.BannedBonds,
            TransformAllowed=autoReq.TransformAllowed,PeopleOptions=r.People==0?[8,9]:[r.People],
            TransformOptions=r.Transforms<0?PlannerStrategies.TransformOptions(autoReq.Strategy):[r.Transforms],Strategy=autoReq.Strategy,MechElite=r.MechElite};
        var planned=planner.Plan(request);
        lastPlans=planned.AllLineups.ToList();
        return new { plans=lastPlans,planned.Error,Limited=planned.Variants.Any(v=>v.SearchLimited) };
    }
}
