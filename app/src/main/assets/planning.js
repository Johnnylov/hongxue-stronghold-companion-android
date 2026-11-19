"use strict";
const Planning = (() => {
  const W = Workbench;
  let choice = null,
    workKind = "";
  let outcome = null,
    display = null,
    task = 0,
    working = false,
    err = "";
  function state() {
    return (db.planning ||= {
      kind: "target",
      goals: {},
      locked: [],
      people: 0,
      transforms: -1,
      strategy: 0,
      mechElite: false,
    });
  }
  function payload() {
    const req = { ...W.request(), ...state() };
    if (req.kind === "auto" && req.people === 0) req.people = 8;
    if (req.onlyRun === false) {
      req.banned = [];
      req.bannedBonds = [];
    } else {
      req.goals = currentGoals(req.goals);
    }
    return req;
  }
  function fingerprint() {
    return JSON.stringify(payload());
  }
  function invalidate() {
    choice = null;
    outcome = null;
    display = null;
    working = false;
    err = "";
    task++;
  }
  function render() {
    const p = state(),
      auto = p.kind === "auto";
    if (outcome && outcome.snapshot !== fingerprint()) invalidate();
    desk.innerHTML =
      W.head("阵容规划") +
      NextStep.progression() +
      `<div class="segments controls">${W.act("plan-tab", "目标规划", auto ? "" : "chosen", "target")}${W.act("plan-tab", "自动推荐", auto ? "chosen" : "", "auto")}</div>
      <div class="filtergrid">${W.control("上场人数", W.select("plan-people", auto ? [8, 9] : [[0, "全部 · 8 / 9 人"], 8, 9], auto ? p.people || 8 : p.people))}${W.control(
        "规划策略",
        W.select(
          "plan-strategy",
          [
            [0, "普通策略"],
            [1, "暴躁铁皮"],
            [2, "优等生 Pith"],
            [3, "变形同构"],
          ],
          p.strategy,
        ),
      )}${
        !auto
          ? W.control(
              "转职次数",
              W.select(
                "plan-transforms",
                [
                  [-1, "全部转职次数"],
                  ...Array.from(
                    { length: p.strategy === 1 || p.strategy === 3 ? 4 : 3 },
                    (_, i) => i,
                  ),
                ],
                p.transforms,
              ),
            )
          : ""
      }</div>
      <label class="checkline"><input type="checkbox" id="plan-only" ${p.onlyRun !== false ? "checked" : ""}> 只看本局可用干员与盟约</label>
      ${p.strategy === 1 ? `<label class="checkline"><input type="checkbox" id="plan-mech" ${p.mechElite ? "checked" : ""}> 暴躁铁皮已精锐</label>` : ""}
      ${
        !auto
          ? section(
              "目标盟约",
              W.act("plan-goals", "选择 Ⅰ / Ⅱ 档目标", "linkbtn"),
            ) +
            `<div class="tags">${
              Object.entries(p.onlyRun === false ? p.goals : currentGoals(p.goals))
                .map(([k, v]) => tag(k + " " + (v === 2 ? "Ⅱ" : "Ⅰ")))
                .join("") || "<p class='hint'>至少选择一个目标盟约。</p>"
            }</div>`
          : ""
      }
      ${section("必带干员", W.act("plan-lock", "选择干员", "linkbtn"))}<div class="tags">${p.locked.map((n) => tag(n + (W.isBanned(n) ? " · 本局暂停" : ""))).join("") || "<p class='hint'>未指定</p>"}</div>
      <div class="actions controls">${W.act("plan-solve", working ? "正在计算…" : auto ? "推荐主盟约与路线" : "搜索阵容", "btn gold")}${working ? W.act("plan-cancel", "取消计算") : ""}</div>
      <div id="plan-output" aria-live="polite">${err ? `<p class="error">${esc(err)}</p>` : ""}${outcome ? results() : ""}</div>`;
  }
  // v1.9.4's ordinary terminal pool admits tiers up to its level. The catalogue
  // merges both custom slots, and the two strategy grants never use the shop pool.
  function recruitment(name, terminal = db.run.terminal) {
    const op = W.rawOps[name];
    if (!op || !Number.isInteger(op.tier) || op.tier < 1 || op.tier > 6)
      return {kind:"unknown", tier:null, minTerminal:null, canRoll:null, label:"招募资料待确认", status:""};
    if (op.requiredStrategyId) {
      const strategy = W.data.strategies.strategies.find(s => s.id === op.requiredStrategyId);
      return {kind:"strategy", tier:op.tier, minTerminal:null, canRoll:false,
        label:(strategy?.name || "策略") + "赠送", status:"第 1 回合获得"};
    }
    const known = Number.isInteger(terminal) && terminal >= 1 && terminal <= 6;
    if (op.isCustom) {
      const enabled = db.prefs.custom.includes(name);
      const canRoll = !enabled ? false : !known ? null : terminal < 5 ? false : terminal === 6 ? true : null;
      const status = !enabled ? "尚未选入自选池" : !known ? "终端待确认"
        : terminal < 5 ? "本级未开放" : terminal === 5 ? "设在 5 阶才可刷" : "本级可刷";
      return {kind:"custom", tier:null, minTerminal:5, canRoll, label:"自选 5 / 6 本", status};
    }
    const canRoll = known ? terminal >= op.tier : null;
    return {kind:"shop", tier:op.tier, minTerminal:op.tier, canRoll,
      label:op.tier + " 本起", status:!known ? "终端待确认" : canRoll ? "本级可刷" : "本级未开放"};
  }
  function memberCard(name, transformed, tripleAt) {
    const recruit = recruitment(name);
    const status = W.isBanned(name) ? "本局禁用" : recruit.status;
    return `<button type="button" class="plan-member recruit-member" data-act="item" ${attr("key","op:"+name)}>
      ${portrait("op:"+name)}<span class="recruit-info"><strong>${esc(name)}</strong>
      <span class="recruit-level">${esc(recruit.label)}</span><small>${esc(status)}</small>
      ${tripleAt ? `<small>${esc(tripleAt)} 本三连获取</small>` : ""}
      ${transformed ? `<small>转 ${esc(transformed)}</small>` : ""}</span></button>`;
  }
  function candidateCard(r, i, auto, rows) {
    const lineup = auto ? r.final : r,
      groupStart =
        !auto &&
        (!i ||
          rows[i - 1].people !== r.people ||
          rows[i - 1].transforms !== r.transforms);
    const heading = groupStart
      ? `<h3 class="variant-heading">${r.people} 人 · ${r.transforms} 次转职 · ${rows.filter((x) => x.people === r.people && x.transforms === r.transforms).length} 套候选</h3>`
      : "";
    const title = auto ? r.mainCovenant : "方案 " + (i + 1);
    const emblem =
      auto && W.data.covenant_icons[r.mainCovenant]
        ? `<img alt="" class="covenant-emblem" src="${esc(W.data.covenant_icons[r.mainCovenant])}">`
        : "";
    const members = [...lineup.operators];
    if (lineup.hasPith && !members.some((o) => o.name === "盟约·辅助干员"))
      members.push({ name: "盟约·辅助干员" });
    if (lineup.strategy === 1 && !members.some((o) => o.name === "“暴躁铁皮”"))
      members.push({ name: "“暴躁铁皮”" });
    const selected = choice?.index === i;
    const styleBar = auto
      ? `<div class="style-choices" role="radiogroup" aria-label="${esc(title)}的打法">${["先小后大", "先大后小"].map((name, n) => `<button role="radio" aria-checked="${selected && choice.style === n}" data-w="plan-route" data-v="${i}/${n}"><b aria-hidden="true">${selected && choice.style === n ? "●" : "○"}</b> ${name}${r.recommendedStyle === n ? "<small>推荐</small>" : ""}</button>`).join("")}</div>`
      : W.act("plan-route", "查看道中路线", "btn light", i + "/0");
    return `${heading}<article class="planrow"><div class="plan-title">${emblem}<h3>${esc(title)}</h3></div><div class="plan-members recruit-members">${members.map(o=>memberCard(o.name,o.transformedCovenant)).join("")}</div>
    <p class="hint">${esc([lineup.hasPith ? "优等生 Pith" : "", ...(lineup.mechCovenants || []), lineup.missingHealer ? "缺少奶位" : "", lineup.freeSlots ? "空位 " + lineup.freeSlots : "", auto ? r.styleReason : ""].filter(Boolean).join(" · "))}</p>${styleBar}
    ${selected ? (display ? routeHtml(display) : working ? "<p class='hint'>正在生成所选路线…</p>" : "") : ""}</article>`;
  }
  function results() {
    const { value, auto } = outcome,
      rows = auto ? value.candidates : value.plans;
    return (
      section(auto ? "候选主盟约" : "候选阵容", `<small class="hint">本局终端 ${esc(db.run.terminal)} 本</small>`) +
      (value.limited || value.searchLimited
        ? `<p class="hint">已到搜索上限，以下为当前找到的候选。</p>`
        : "") +
      (value.error ? `<p class="error">${esc(value.error)}</p>` : "") +
      (!rows?.length
        ? empty("没有找到候选", "可以调整目标、必带干员或转职次数再试。")
        : `<div class="listbox">${rows
            .map((r, i) => candidateCard(r, i, auto, rows))
            .join("")}</div>`)
    );
  }
  function routeHtml(g) {
    return `<article id="route-result">${section(g.title, W.act("plan-save", "保存并追踪", "btn gold"))}${g.stages.map(s => {
      const units = s.entries.filter(e => e.key.startsWith("op:"));
      return `<details class="note"><summary>${esc(GuideModel.stageText(s))} · ${s.terminalLevel} 本 · ${units.length} 人</summary>
        <div class="plan-members recruit-members">${units.map(e => memberCard(e.key.slice(3), e.transformedCovenant, e.viaTriple && s.terminalLevel)).join("")}</div>
        <p>${esc(s.note)}</p></details>`;
    }).join("")}</article>`;
  }
  async function click(a, v) {
    const p = state();
    if (a === "plan-tab") {
      invalidate();
      p.kind = v;
      persist();
      render();
      return;
    }
    if (a === "plan-cancel") {
      W.stopEngine();
      invalidate();
      render();
      return;
    }
    if (a === "plan-lock") {
      W.picker(
        "必带干员",
        W.opChoices(
          Object.keys(W.rawOps).filter(
            (n) => !W.rawOps[n].isCustom || db.prefs.custom.includes(n),
          ),
        ),
        p.locked,
        (vals) => {
          p.locked = vals;
          invalidate();
          persist();
          render();
        },
        9,
      );
      return;
    }
    if (a === "plan-goals") {
      chooseGoals(p.goals, (vals) => {
        p.goals = vals;
        invalidate();
        persist();
        render();
      }, p.onlyRun !== false);
      return;
    }
    if (a === "plan-save" && display) {
      previewStage = 0;
      incorporate(display);
      return;
    }
    if (working && !(a === "plan-route" && workKind === "plan-route")) return;
    const req = payload(),
      automatic = p.kind === "auto",
      snap = fingerprint();
    const ticket = ++task;
    if (a === "plan-solve" && !automatic && !Object.keys(req.goals).length) {
      toast("请先选择目标盟约");
      return;
    }
    workKind = a;
    if (a === "plan-route") {
      const [index, style] = v.split("/").map(Number);
      choice = { index, style };
      display = null;
    } else {
      choice = null;
      display = null;
    }
    working = true;
    err = "";
    render();
    try {
      if (a === "plan-solve") {
        const value = await W.engine(automatic ? "auto" : "target", req);
        if (ticket !== task || snap !== fingerprint()) return;
        outcome = { snapshot: snap, value, auto: automatic };
        display = null;
      } else if (a === "plan-route") {
        const [index, style] = v.split("/").map(Number);
        const response = await W.engine(automatic ? "autoRoute" : "route", {
          ...req,
          index,
          style,
        });
        if (ticket !== task || snap !== fingerprint()) return;
        const route = response.route || response,
          candidate = automatic
            ? outcome.value.candidates[index].final
            : outcome.value.plans[index];
        const title =
          (automatic
            ? response.mainCovenant
            : Object.keys(p.goals).join("＋")) +
          " · " +
          (automatic ? (style === 0 ? "先小后大" : "先大后小") : "目标路线");
        const namesByBond = W.data.covenants.jobChangeEquipmentToCovenant;
        const stages = route.stages.map((s, i) => {
          const adv = response.advice?.[i],
            entries = s.operators.map((o) => {
              const gear = o.transformedCovenant
                ? Object.keys(namesByBond).find(
                    (k) => namesByBond[k] === o.transformedCovenant,
                  )
                : null;
              return {
                key: "op:" + o.name,
                detail: [
                  o.role === 1 ? "过渡" : "最终",
                  o.viaTriple ? "三连" : "",
                  o.transformedCovenant && "转职 " + o.transformedCovenant,
                ]
                  .filter(Boolean)
                  .join(" · "),
                role: o.role === 1 ? "过渡" : "最终",
                viaTriple: !!o.viaTriple,
                transformedCovenant: o.transformedCovenant || null,
                equipment: gear ? ["变形同构体", gear] : [],
              };
            });
          return {
            label: s.definition.name,
            terminalLevel: s.definition.terminalLevel,
            start: 3 * i + 1,
            end: s.isFinal
              ? GuideModel.maxRound
              : Math.min(GuideModel.maxRound, 3 * i + 3),
            entries,
            isFinal: s.isFinal,
            bonds: s.covenants.filter((c) => c.level > 0).map((c) => c.name),
            note: [
              s.definition.terminalLevel +
                " 本 · 理论每回合叠层 " +
                Math.round(s.summary.finalLayers || 0),
              ...s.summary.warnings,
              adv?.focus,
              adv?.upgradeText,
              adv?.reserve?.length &&
                "提前留牌：" + adv.reserve.map((q) => q.name).join("、"),
              adv?.keyCards?.length && "关键牌：" + adv.keyCards.join("、"),
            ]
              .filter(Boolean)
              .join("\n"),
          };
        });
        display = {
          title,
          stages,
          goals: Object.fromEntries(
            candidate.goals.map((g) => [g.name, g.level]),
          ),
          strategyIds: p.strategy
            ? [["", "band_mech", "band_pith", "band_damaztic"][p.strategy]]
            : [],
          blurb: response.styleReason || "按所选目标盟约生成",
          conditions: req,
          autoPlan: automatic
            ? {
                candidate: outcome.value.candidates[index],
                savedRoute: route,
                style,
              }
            : null,
        };
      }
    } catch (e) {
      if (ticket === task) err = "计算失败：" + e.message;
    } finally {
      if (ticket === task) {
        working = false;
        if (db.page === "planner") {
          render();
          if (display && a === "plan-route")
            $("route-result")?.scrollIntoView({ block: "nearest" });
        }
      }
    }
  }
  const peopleSecond = ["精准", "坚守", "助力", "不屈", "聚合", "奥术"];
  function runGoalLevel(c, level) {
    if (!level || !db.run.bannedBonds.includes(c.name)) return level;
    if (c.bondType === "SEASON") return 0;
    const available = W.availableHolders(c.name);
    if (available < (c.activateCount ?? 2)) return 0;
    return level === 2 && (!peopleSecond.includes(c.name) || available < 3) ? 1 : level;
  }
  function currentGoals(goals) {
    return Object.fromEntries(W.data.covenants.covenants.filter(c => goals[c.name])
      .map(c => [c.name, runGoalLevel(c, goals[c.name])]).filter(([, level]) => level));
  }
  function chooseGoals(old, save, useRun = false) {
    const cov = W.data.covenants.covenants.filter((c) => c.name !== "绝技"),
      single = ["独行", "协防干员", "调和"];
    function setting(c, i) {
      const grey = useRun && db.run.bannedBonds.includes(c.name);
      const core = c.bondType === "SEASON";
      const options = [[0, "未指定"]];
      const maxLevel = useRun ? runGoalLevel(c, 2) : 2;
      if (maxLevel > 0) {
        options.push([1, "Ⅰ"]);
        if (!single.includes(c.name) && maxLevel === 2)
          options.push([2, core || peopleSecond.includes(c.name) ? "Ⅱ" : "Ⅱ *"]);
      }
      const label = c.name + (grey ? core ? " · 本局已禁" : " · 剩 " + W.availableHolders(c.name) + " 名原生干员" : "");
      return W.control(label, W.select("goal-" + i, options, Math.min(old[c.name] || 0, options.at(-1)[0])));
    }
    popup(`<h2>目标盟约</h2><p class="hint">Ⅱ档带 * 的盟约还需人工核对层数或精锐条件。</p><div class="filtergrid">${cov.map(setting).join("")}</div><button id="goals-ok" class="btn gold">保存目标</button>`);
    $("goals-ok").onclick = () => {
      const vals = Object.fromEntries(
        cov
          .map((c, i) => [c.name, Number($("goal-" + i).value)])
          .filter((x) => x[1]),
      );
      close();
      save(vals);
    };
  }
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!db || !el.id.startsWith("plan-")) return;
    const p = state(),
      k = el.id.slice(5);
    if (k === "mech") p.mechElite = el.checked;
    else if (k === "only") p.onlyRun = el.checked;
    else p[k] = Number(el.value);
    if (![1, 3].includes(p.strategy)) p.transforms = Math.min(2, p.transforms);
    invalidate();
    persist();
    render();
  });
  return { render, click, chooseGoals, recruitment };
})();
