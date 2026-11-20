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
  let attempted = "", pendingSnapshot = "", autoBank, matchSettings = false;
  let stageAdvice=[];
  const routeCache=new WeakMap();
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
  function payload(kind=state().kind) {
    const req = { ...W.request(), ...state(), kind };
    if (req.kind === "auto") {
      const held = PlanMatch.holdings();
      req.people ||= 8;
      req.locked = [];
      req.owned = held.map(u=>u.name);
      req.preferred = PlanMatch.weights(held);
      req.custom = [...new Set([...req.custom,...req.owned.filter(n=>W.rawOps[n].isCustom)])];
      req.modeId = db.run.mode;
      const income = Economy.funding(db.run.mode,req.round,W.data.economy);
      req.estimated = req.money == null && !!income;
      if (req.estimated) req.money = Economy.balance(income.amount + ItemIncome.total(db.run));
    } else if (req.onlyRun === false) {
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
    stageAdvice=[];
    working = false;
    err = "";
    attempted = "";
    pendingSnapshot = "";
    task++;
  }
  function autoSearch(req) {
    // Cash, terminal and upgrade price change the ordering and advice locally.
    const key = JSON.stringify([req.people,req.strategy,req.mechElite,req.preferred,req.custom,req.banned,req.bannedBonds]);
    if (autoBank?.key !== key) {
      const entry = {key,promise:W.engine("auto",req)};
      autoBank = entry;
      entry.promise.catch(()=>{ if(autoBank===entry) autoBank=null; });
    }
    return autoBank.promise;
  }
  async function automaticRoute(candidate,style,req,index) {
    // The route depends on lineup and style. Re-evaluate its advice when the live shop changes.
    const shop={...req,money:req.estimated?null:req.money,index,style,candidate};
    let variants=routeCache.get(candidate);
    if (!variants) { variants=new Map();routeCache.set(candidate,variants); }
    const key=JSON.stringify([shop.terminal,shop.round,shop.money,shop.upgrade,shop.owned]);
    let cached=variants.get(style);
    if (!cached) {
      cached={key,result:W.engine("autoRoute",shop)};
      variants.set(style,cached);
      cached.result.catch(()=>{if(variants.get(style)===cached) variants.delete(style);});
    }
    const result=await cached.result;
    if (cached.key===key) return result;
    const advice=await W.engine("advice",{...shop,savedRoute:result.route});
    return {...result,advice};
  }
  async function matchRoute(req, preferredCore) {
    const result=await autoSearch(req);
    const ranked=PlanMatch.rank(result.candidates || [],req);
    const selected=ranked.find(r=>r.candidate.mainCovenant===preferredCore) || ranked[0];
    if (!selected) throw Error(result.error || "当前禁用条件下没有候选阵容");
    const c=selected.candidate, style=c.recommendedStyle || 0;
    const response=await automaticRoute(c,style,req,selected.index);
    return {route:response.route,advice:response.advice,title:c.mainCovenant+" · "+(style===0?"先小后大":"先大后小")};
  }
  function stageCard(stage, badge) {
    if (!stage) return "";
    const d=stage.definition, summary=stage.summary || {};
    const roman=["","Ⅰ","Ⅱ","Ⅲ","Ⅳ","Ⅴ","Ⅵ"];
    const goalNames=new Set((stage.covenants || []).filter(c=>c.isGoal).map(c=>c.name));
    const chips=[!stage.isFinal && !d.stacking && "≤ "+roman[d.maxTier]+" 阶", d.people+" 人",
      d.tripleSlots && "三连 ≤ "+d.tripleSlots, d.stacking && "叠层"];
    const roles=["盾 "+(summary.tanks || 0),summary.healingCovenant && !summary.healers?"奶 聚合":"奶 "+(summary.healers || 0),"叠 "+(summary.stackers || 0)];
    const cards=stage.operators.map(o=>{
      const tags=[o.isTank && "盾",o.isHealer && "奶",o.isStacker && "叠"].filter(Boolean);
      const cvs=o.covenants || [];
      const sub=o.transformedCovenant ? "转职 "+o.transformedCovenant : tags.join(" · ") || cvs.find(n=>goalNames.has(n)) || cvs[0] || "";
      return `<button type="button" data-act="item" class="route-op" ${attr("key","op:"+o.name)}>
        <span class="route-face ${o.role===1?"transition":"final"}">${portrait("op:"+o.name)}
          <small class="tier">${esc(roman[o.tier] || o.tier)}</small>${o.viaTriple?'<small class="triple">三连</small>':""}${o.isNew?'<small class="new" title="本阶段新加入">新</small>':""}</span>
        <strong>${esc(o.name)}</strong><small>${esc(sub)}</small></button>`;
    }).join("");
    return `<section class="route-stage-card"><div class="route-stage-head"><h4>${esc(stage.isFinal?"成型阵容":d.name)}</h4>
      ${badge?tag(badge):""}<b>终端 ${esc(d.terminalLevel)}</b></div>
      <div class="route-limits">${chips.filter(Boolean).map(tag).join("")}</div>
      <div class="route-roles">${roles.map(tag).join("")}</div>
      <div class="route-faces">${cards}</div></section>`;
  }
  function routePanel(route, advice, terminal, final=false, trial=false) {
    const all=(advice || []).flatMap((a,i)=>(a.levels || []).map(level=>({level,stage:route.stages[i]})));
    const current=all.find(x=>x.level.terminalLevel===(final?0:terminal));
    const entry=current || all.find(x=>x.level.terminalLevel>terminal);
    if (!entry?.stage) return "";
    const preview=!current;
    const tryStage=trial ? W.act("map-trial-stage","将这套阶段阵容放到地图试摆","btn light",JSON.stringify(entry.stage.operators.map(o=>o.name))) : "";
    return stageCard(entry.stage,preview?"下一本":"当前")+tryStage+levelCard(entry.level,preview?"升至 "+entry.level.terminalLevel+" 本后 · ":"");
  }
  function levelCard(level,prefix="") {
    const picks=level.reserve || [];
    return `<section class="level-advice" data-advice-level="${Number(level.terminalLevel)}">
      <h4>${esc(prefix+level.title)}</h4><dl>
      <dt>当前目标</dt><dd>${esc(level.focus)}</dd>
      <dt>优先购买 <small>按本局持有记录</small></dt><dd class="advice-purchases">${esc(level.purchaseText || "本级暂无优先购买人选")}</dd>
      <dt>升本条件</dt><dd>${esc(level.upgradeText)}</dd>
      <dd class="hint">${esc(level.economyText)}</dd>
      ${picks.length?`<dt>提前留牌</dt><dd>有余钱与空位再买，先留足关键购买和升级资金。</dd><dd class="advice-reserve">${picks.map(p=>`<button type="button" data-act="item" ${attr("key","op:"+p.name)}>${portrait("op:"+p.name)}<span><strong>${esc(p.name)}</strong><small>${esc(p.neededAt)}用</small></span></button>`).join("")}</dd>`:""}</dl></section>`;
  }
  function tabs(kind) {
    return '<div class="segments controls">' + [["target","目标规划"],["auto","自动推荐"],["workshop","阵容推演"]]
      .map(([id,label])=>W.act("plan-tab",label,id===kind?"chosen":"",id)).join("") + '</div>';
  }
  function render() {
    if (state().kind === "workshop") { Workshop.render(); return; }
    document.body.classList.remove("workshop-open");
    const p = state(),
      auto = p.kind === "auto";
    const multiplayer = W.data.multiplayer_bans[db.run.mode];
    const snap = fingerprint();
    if ((outcome && outcome.snapshot !== snap) || (working && pendingSnapshot !== snap)) invalidate();
    desk.innerHTML =
      W.head("阵容规划") +
      NextStep.progression() +
      `${tabs(p.kind)}
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
      ${auto ? "" : `<label class="checkline"><input type="checkbox" id="plan-only" ${p.onlyRun !== false ? "checked" : ""}> 只看本局可用干员与盟约</label>`}
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
      ${auto ? `<div class="match-inputs" role="group" aria-label="多人难度">${Object.entries(W.data.multiplayer_bans).map(([id,m])=>`<button class="chip" data-w="plan-mode" data-v="${esc(id)}" aria-pressed="${db.run.mode===id}">${esc(m.name)}</button>`).join("")}</div>
        <div class="match-inputs"><b>持有 ${PlanMatch.holdings().length} 名 · ${db.run.terminal} 本 · ${db.run.money==null?"余额未录":"资金 "+db.run.money}</b>${W.act("owned","调整持有","linkbtn")}${W.act("ban-bonds","本局 Ban","linkbtn")}${W.act("plan-run-settings",matchSettings?"收起对局设置":"对局设置","linkbtn")}</div>${matchSettings ? W.runPanel() : ""}`
        : section("必带干员", W.act("plan-lock", "选择干员", "linkbtn")) + `<div class="tags">${p.locked.map((n) => tag(n + (W.isBanned(n) ? " · 本局暂停" : ""))).join("") || "<p class='hint'>未指定</p>"}</div>`}
      <div class="actions controls">${auto && !multiplayer ? "<p>点选本局的多人难度后查看推荐。</p>" : W.act("plan-solve", working ? "正在计算…" : auto ? "更新本局推荐" : "搜索阵容", "btn gold")}${working ? W.act("plan-cancel", "取消计算") : ""}</div>
      <div id="plan-output" aria-live="polite">${err ? `<p class="error">${esc(err)}</p>` : ""}${outcome ? results() : ""}</div>`;
    if (auto && multiplayer && !outcome && !working && attempted !== snap) {
      attempted = snap;
      setTimeout(()=>{ if (db.page==="planner" && state().kind==="auto" && !working && !outcome && attempted===snap && fingerprint()===snap) void click("plan-solve"); }, 40);
    }
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
    const req = payload();
    const ranked = auto ? PlanMatch.rank(rows || [],req) : null;
    const selectedPlan=ranked?.find(r=>r.index===choice?.index) || ranked?.[0];
    const level=stageAdvice.flatMap(a=>a.levels || []).find(l=>l.terminalLevel===req.terminal);
    return (
      (selectedPlan ? PlanMatch.summary(selectedPlan,req,level,selectedPlan===ranked[0]) : "") +
      (auto && display?.autoPlan ? routePanel(display.autoPlan.savedRoute,stageAdvice,req.terminal) : "") +
      section(auto ? "候选主盟约" : "候选阵容", `<small class="hint">本局终端 ${esc(db.run.terminal)} 本</small>`) +
      (value.limited || value.searchLimited
        ? `<p class="hint">已到搜索上限，以下为当前找到的候选。</p>`
        : "") +
      (value.error ? `<p class="error">${esc(value.error)}</p>` : "") +
      (!rows?.length
        ? empty("没有找到候选", "可以调整目标、必带干员或转职次数再试。")
        : `<div class="listbox">${(ranked ? ranked.map(x=>candidateCard(x.candidate,x.index,true,rows)) :
            rows.map((r, i) => candidateCard(r, i, false, rows)))
            .join("")}</div>`)
    );
  }
  function routeHtml(g) {
    return `<article id="route-result">${section(g.title, W.act("plan-workshop", "在阵容推演打开", "btn light") + W.act("plan-save", "保存并追踪", "btn gold"))}${g.stages.map((s,i) => {
      const units = s.entries.filter(e => e.key.startsWith("op:"));
      return `<details class="note"><summary>${esc(GuideModel.stageText(s))} · ${s.terminalLevel} 本 · ${units.length} 人</summary>
        <div class="plan-members recruit-members">${units.map(e => memberCard(e.key.slice(3), e.transformedCovenant, e.viaTriple && s.terminalLevel)).join("")}</div>
        <p>${esc(s.note)}</p>${(stageAdvice[i]?.levels || []).map(l=>levelCard(l)).join("")}</details>`;
    }).join("")}</article>`;
  }
  function routeKey(team) {
    if (!team.conditions) return null;
    const auto = team.autoPlan;
    const stages = auto?.savedRoute?.stages?.map(s=>[s.definition.name,s.definition.terminalLevel,
      s.operators.map(o=>JSON.stringify([o.name,o.transformedCovenant || "",o.role,!!o.viaTriple])).sort()]) ||
      team.stages.map(s=>[s.label,s.terminalLevel,s.entries.map(e=>JSON.stringify([e.key,e.transformedCovenant || "",e.role,!!e.viaTriple])).sort()]);
    return JSON.stringify([auto?.candidate?.mainCovenant || "",auto?.style ?? null,team.strategyIds || [],
      Object.entries(team.goals || {}).sort(),stages]);
  }
  function trackRoute(guide, editor) {
    if (editor) state().kind="workshop";
    const id = routeKey(guide);
    const existing = [active(), ...db.teams].find(t=>t && routeKey(t)===id);
    db.prefs.basketTab = "shop";
    if (existing) {
      db.active = existing.id;
      move(editor?"planner":"teams",existing.id);
      return;
    }
    let stage = 0;
    guide.stages.forEach((s,i)=>{ if (!s.isFinal && s.terminalLevel <= db.run.terminal) stage=i; });
    incorporate(guide,stage,RunLineups.ownedTokens(guide),editor?"planner":"teams");
  }
  async function click(a, v, reveal=true) {
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
      autoBank=null;
      invalidate();
      attempted=fingerprint();
      render();
      return;
    }
    if (a === "plan-run-settings") {
      matchSettings=!matchSettings;
      render();
      return;
    }
    if (a === "plan-mode") {
      if (!W.data.multiplayer_bans[v] || v===db.run.mode) return;
      db.run.mode=v;
      db.run.upgrade=null;
      Maps.bansChanged();
      persist(); render(); renderBasket();
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
    if ((a === "plan-save" || a === "plan-workshop") && display) {
      trackRoute(display,a==="plan-workshop");
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
    stageAdvice=[];
    let defaultRoute=null;
    workKind = a;
    pendingSnapshot = snap;
    attempted = snap;
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
        const value = await (automatic ? autoSearch(req) : W.engine("target",req));
        if (ticket !== task || snap !== fingerprint()) return;
        outcome = { snapshot: snap, value, auto: automatic };
        if (automatic && value.candidates?.length) {
          const best=PlanMatch.rank(value.candidates,req)[0];
          defaultRoute=best.index+"/"+(best.candidate.recommendedStyle || 0);
        }
        display = null;
      } else if (a === "plan-route") {
        const [index, style] = v.split("/").map(Number);
        const response=automatic ? await automaticRoute(outcome.value.candidates[index],style,req,index)
          : await W.engine("route",{...req,index,style});
        if (ticket !== task || snap !== fingerprint()) return;
        stageAdvice=response.advice || [];
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
          if(defaultRoute) void click("plan-route",defaultRoute,false);
          if (reveal && display && a === "plan-route")
            $("route-result")?.scrollIntoView({ block: "nearest" });
        }
      }
    }
  }
  const peopleSecond = ["精准", "坚守", "助力", "不屈", "聚合", "奥术"];
  function runGoalLevel(c, level) {
    if (!level || !W.effectiveBonds().includes(c.name)) return level;
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
      const grey = useRun && W.effectiveBonds().includes(c.name);
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
  return { render, click, chooseGoals, recruitment, tabs, levelCard, stageCard, routePanel, matchRoute, payload };
})();
