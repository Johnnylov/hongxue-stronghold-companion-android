"use strict";
const GuideModel = (() => {
  const base = "https://game.skland.com/arknights/stronghold-guide";
  const maxRound = 16;
  function defaultRange(label) {
    const bounds = { 前期: [1, 5], 中期: [6, 10], 成型: [11, maxRound] }[label];
    return bounds
      ? {
          start: bounds[0],
          end: bounds[1],
          rangeSource: "默认参考",
          isFinal: label === "成型",
        }
      : {};
  }
  function stageText(s) {
    if (s.start && s.end) {
      const range =
        s.start === s.end
          ? "第 " + s.start + " 回合"
          : "第 " + s.start + "–" + s.end + " 回合";
      if (/^回合\s*[\d–—-]+$/.test(s.label)) return range;
      return (s.label === "成型" ? "后期成型" : s.label) + " · " + range;
    }
    if (s.label === "挂件") return "挂件 · 全程按需";
    if (s.isFinal || /成型/.test(s.label)) return "成型目标 · 无固定回合";
    return s.label + " · 回合未设置";
  }
  function stage(label, note, ops, gear) {
    const entries = [
      ...ops.map((name) => ({ key: "op:" + name })),
      ...gear.map((name) => ({ key: "eq:" + name })),
    ];
    return { label, note, entries, ...defaultRange(label) };
  }
  const offline = [
    {
      id: "ib",
      title: "伊比利亚 · 聚合起步",
      blurb: "用低阶伊比利亚干员起步，再把流明接入聚合。",
      cover: ["海沫", "流明", "棘刺"],
      tags: ["伊比利亚", "聚合"],
      stages: [
        stage(
          "前期",
          "先把深靛、瑰盐和蓝毒列入清单。三人到齐时检查伊比利亚盟约，再决定是否留钱升级。",
          ["深靛", "瑰盐", "蓝毒"],
          [],
        ),
        stage(
          "中期",
          "海沫和旅骨补进本家阵容。看到流明时与瑰盐配对，检查聚合是否已经点亮。",
          ["瑰盐", "海沫", "旅骨", "流明"],
          ["聚合急救箱"],
        ),
        stage(
          "成型",
          "以六名伊比利亚干员为目标，保留流明和瑰盐的聚合。关键人选被禁用时，可在自己的阵容中替换同盟约干员。",
          ["瑰盐", "蓝毒", "海沫", "旅骨", "流明", "棘刺"],
          ["聚合急救箱", "伊比利亚骨刺刀"],
        ),
      ],
    },
    {
      id: "lt",
      title: "莱塔尼亚 · 奥术成型",
      blurb: "从折光过渡，围绕艾雅法拉与薇薇安娜搭配奥术。",
      cover: ["折光", "艾雅法拉", "薇薇安娜"],
      tags: ["莱塔尼亚", "奥术"],
      stages: [
        stage(
          "前期",
          "地灵、折光与复奏都是本家低阶人选。先凑齐三个不同干员，再沿清单寻找中期替换。",
          ["地灵", "折光", "复奏"],
          [],
        ),
        stage(
          "中期",
          "加入车尔尼和艾雅法拉。先检查生存位置，再决定是否留下额外输出。",
          ["地灵", "折光", "复奏", "车尔尼", "艾雅法拉"],
          ["坚守盾牌"],
        ),
        stage(
          "成型",
          "艾雅法拉与薇薇安娜同时提供奥术。保留足够的莱塔尼亚干员冲六人，装备按实战缺口取舍。",
          ["折光", "复奏", "车尔尼", "黑键", "艾雅法拉", "薇薇安娜"],
          ["坚守盾牌", "奥术法阵"],
        ),
      ],
    },
    {
      id: "us",
      title: "乌萨斯 · 低阶过渡",
      blurb: "从折桠、烈夏和真理开局，逐步替换高阶位置。",
      cover: ["折桠", "赫拉格", "怒潮凛冬"],
      tags: ["乌萨斯", "过渡"],
      stages: [
        stage(
          "前期",
          "折桠、烈夏和真理组成三个不同的乌萨斯人选。商店未出齐时，按实际购买情况逐项标记。",
          ["折桠", "烈夏", "真理"],
          [],
        ),
        stage(
          "中期",
          "补入乌啾、奥尔佳与赫拉格。先留住现有盟约，再考虑把低阶位置换给高阶人选。",
          ["折桠", "烈夏", "真理", "乌啾", "奥尔佳", "赫拉格"],
          ["坚守盾牌"],
        ),
        stage(
          "成型",
          "将维伊和怒潮凛冬列为后续购买目标。替换旧人选前，先核对场上是否仍能保留六名乌萨斯干员。",
          ["折桠", "真理", "乌啾", "赫拉格", "维伊", "怒潮凛冬"],
          ["乌萨斯呼吸器", "坚守盾牌"],
        ),
      ],
    },
  ];
  const featured = [
    {
      id: "2120392178422509756",
      title: "2本伊比利亚能兜底能打boss流派",
      author: "狂暴绮良厨组长",
    },
    {
      id: "2120569391147659132",
      title: "裁度老版精准叙拉古运营思路（前期无荒拉如何叠层）",
      author: "诗生歆乃",
    },
  ];
  function guideId(input) {
    let uri;
    try {
      uri = new URL(input.trim());
    } catch (_) {
      throw Error("请粘贴森空岛卫戍协议攻略详情链接。");
    }
    const id = uri.searchParams.get("guideId");
    if (
      uri.origin !== "https://game.skland.com" ||
      uri.username ||
      uri.password ||
      uri.pathname.replace(/\/$/, "") !==
        "/arknights/stronghold-guide/detail" ||
      !/^\d{1,30}$/.test(id || "")
    )
      throw Error("请打开具体攻略，复制含 guideId 的详情链接。");
    return id;
  }
  function fromSkland(payload, id) {
    if (payload.code !== 0)
      throw Error(String(payload.message || "森空岛暂时无法提供这篇攻略。"));
    const item = payload.data?.guide;
    if (!item || item.invalid) throw Error("这篇攻略已失效。");
    const guide = item.guide;
    if (guide.guideId !== id) throw Error("攻略编号不匹配，请重新复制链接。");
    const res =
      payload.data.seasonResourceMap?.[guide.seasonId]?.versionResourceMap?.[
        guide.versionId
      ];
    if (!res || !guide.tabs?.length)
      throw Error("这篇攻略缺少阶段或资源资料。");
    function lookup(group, key) {
      const value = res[group]?.[key];
      if (!value?.name) throw Error("这篇攻略的资源尚不完整，请稍后重试。");
      return value;
    }
    const stages = guide.tabs
      .map((part, order) => {
        if (![1, 2].includes(part.tabType))
          throw Error("这篇攻略使用了暂不支持的阶段格式。");
        const final = part.tabType === 1;
        const entries = (part.recChars || []).map((p) => {
          const c = lookup("chars", p.charId);
          const notes = [
            p.mergeLevel ? "精锐" : "",
            c.skills?.find((x) => x.skillId === p.skillId)?.name,
            c.modules?.find((x) => x.moduleId === p.moduleId)?.name,
          ].filter(Boolean);
          return {
            key: "op:" + c.name,
            detail: notes.join(" · "),
            elite: !!p.mergeLevel,
            loadout: {
              charId: p.charId,
              skillId: p.skillId,
              moduleId: p.moduleId,
              skills: (c.skills || []).map((x) => ({
                id: x.skillId,
                name: x.name,
              })),
              modules: (c.modules || []).map((x) => ({
                id: x.moduleId,
                name: x.name,
              })),
            },
          };
        });
        for (const p of part.recItems || [])
          entries.push({ key: "eq:" + lookup("items", p.itemId).name });
        const bonds = Object.values(part.activeBonds || {})
          .flat()
          .map((key) => lookup("bonds", key).name);
        return {
          label: final
            ? "成型阵容"
            : "回合 " + part.startRound + "–" + part.endRound,
          note: part.operationIdea || "",
          bonds,
          entries,
          isFinal: final,
          start: final ? null : part.startRound,
          end: final ? null : part.endRound,
          rank: final ? Number.MAX_SAFE_INTEGER : part.startRound,
          order,
        };
      })
      .sort((a, b) => a.rank - b.rank || a.order - b.order);
    const strategies = (guide.strategyIds || []).map(
      (key) => lookup("strategies", key).name,
    );
    return {
      id: "sk-" + id,
      title: guide.title,
      author: item.poster?.nickname || "森空岛用户",
      source: base + "/detail?guideId=" + id,
      strategyIds: guide.strategyIds || [],
      tags: strategies,
      blurb: guide.applicableScope || "",
      stages,
    };
  }
  function shoppingRows(stage) {
    const counts = new Map();
    return stage.entries.map((entry) => {
      const n = (counts.get(entry.key) || 0) + 1;
      counts.set(entry.key, n);
      return { ...entry, token: JSON.stringify([entry.key, n]) };
    });
  }
  return {
    base,
    offline,
    featured,
    guideId,
    fromSkland,
    shoppingRows,
    defaultRange,
    stageText,
    maxRound,
  };
})();
