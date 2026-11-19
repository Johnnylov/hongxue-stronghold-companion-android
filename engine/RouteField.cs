using ASPAssistant.Core.Models;

namespace ASPAssistant.Core.Services;

public sealed partial class PlacementPlanner
{
    private sealed record RouteLane(BoardCell[] Cells, int[] Indices, int[] FirstVisits);
    private sealed record RouteWeights(double[] Dwell, double[] KillZone, double[] Penalties);

    // Within a search, tile exposure depends only on the first occupied cell of each route.
    // Keep every addition in route order, including repeated visits and the palace teleport.
    private sealed class RouteField
    {
        private readonly BoardInfo board;
        private readonly int left, top, width, height;
        private readonly Dictionary<(int, int, int), RouteWeights> cached = [];
        public readonly RouteLane[] Lanes;

        public RouteField(BoardInfo board)
        {
            this.board = board;
            var routes = board.Routes.Concat(board.Extra).ToArray();
            var cells = board.Map.AllCells().Select(p => p.Cell).Concat(routes.SelectMany(r => r)).ToArray();
            left = cells.Min(c => c.Col);
            top = cells.Min(c => c.Row);
            width = cells.Max(c => c.Col) - left + 1;
            height = cells.Max(c => c.Row) - top + 1;
            Lanes = routes.Select(r => {
                var seen = new HashSet<BoardCell>();
                return new RouteLane(r, r.Select(Index).ToArray(), Enumerable.Range(0, r.Length).Where(j => seen.Add(r[j])).ToArray());
            }).ToArray();
        }

        public int Index(BoardCell cell)
        {
            int x = cell.Col - left, y = cell.Row - top;
            return (uint)x < width && (uint)y < height ? 1 + y * width + x : 0;
        }

        public RouteWeights For(int?[] fronts, int? extra)
        {
            var key = (fronts.Length > 0 ? fronts[0] ?? -1 : -1, fronts.Length > 1 ? fronts[1] ?? -1 : -1, extra ?? -1);
            if (fronts.Length <= 2 && cached.TryGetValue(key, out var found)) return found;
            var dwell = new double[1 + width * height];
            var kill = new double[dwell.Length];
            var penalties = new List<double>();
            for (int k = 0; k < Lanes.Length; k++)
            {
                var lane = Lanes[k];
                int? front = k < fronts.Length ? fronts[k] : extra;
                double rw = k >= fronts.Length ? 0.6 : k < RouteWeight.Length ? RouteWeight[k] : 1;
                for (int j = 0; j < lane.Indices.Length; j++)
                {
                    int index = lane.Indices[j];
                    if (front is not int b) { dwell[index] += 0.15 * rw; continue; }
                    double w = j <= b ? 0.15 + (b - j) switch { 0 => 1.9, 1 => 1.2, 2 => 0.6, _ => 0 } : 0.12;
                    dwell[index] += w * rw;
                    if (j <= b && b - j <= 2) kill[index] += (b - j) switch { 0 => 2.0, 1 => 1.2, _ => 0.5 } * rw;
                }
            }
            if (board.Tile is { } tile)
                for (int k = 0; k < fronts.Length; k++)
                {
                    var lane = Lanes[k];
                    for (int j = 0; j < lane.Cells.Length; j++)
                    {
                        if (fronts[k] is int b && j > b || !board.Special.Contains(lane.Cells[j])) continue;
                        if (tile.Kind == TileKind.EnemyBuff) penalties.Add(tile.EnemyPenalty * (k < RouteWeight.Length ? RouteWeight[k] : 1));
                        if (tile.Kind == TileKind.Slow) dwell[lane.Indices[j]] *= 1.4;
                    }
                }
            var result = new RouteWeights(dwell, kill, [.. penalties]);
            if (fronts.Length <= 2) cached[key] = result;
            return result;
        }
    }
}
