"use strict";
const NextStep = (() => {
  const W = Workbench;
  let adviceJob;

  function card(title, detail, action = "") {
    return `<strong>${esc(title)}</strong>${detail ? `<p>${esc(detail)}</p>` : ""}${action}`;
  }
  function cashHint(considerUpgrade = false) {
    const r = db.run, cost = Economy.price(r, W.data.economy);
    if (r.terminal >= 6) return "终端已满级，本轮资金优先用于补牌。";
    if (cost == null) return "在对局设置中确认升级价，再决定是否升本。";
    if (cost === 0) return `当前升级免费，可先把终端升至 ${r.terminal + 1} 本。`;
    if (r.money == null) return `升至 ${r.terminal + 1} 本需 ${cost} 资金，先点选当前余额，再决定是否升本。`;
    if (r.money < cost) return `升至 ${r.terminal + 1} 本还差 ${cost-r.money} 资金，本轮先留在 ${r.terminal} 本${r.money ? "补缺口或合对子" : "调整现有站位"}。`;
    if (considerUpgrade) return `如果当前站位能守，可先升至 ${r.terminal + 1} 本，支付 ${cost} 后本轮余 ${r.money-cost} 资金。`;
    return `若升至 ${r.terminal + 1} 本需 ${cost} 资金，升后余 ${r.money-cost}。`;
  }
  function levelTip(terminal) {
    return [
      "",
      "一本先用可用的一阶干员过渡，高阶人选等升本后再找。",
      "二本可找二阶牌，先把能上场的干员补齐，再考虑升三本。",
      "三本可找三阶牌，优先能补上阻挡、治疗或目标盟约的人选。",
      "四本可找四阶牌，先看关键干员的对子，差一张的精锐可在本级补。",
      "五本可找五阶叠层手。成型阵容有六阶缺口时，再考虑升六本。",
      "六本已满级。本轮补成型缺口，打领袖前核对阻挡、治疗和朝向。",
    ][terminal] || "先在对局设置核对终端等级。";
  }
  function missing(target) {
    const have = {name:target.name, count:db.run.counts[target.name] || 0, elite:db.run.elite[target.name] || 0};
    const cost = QuickRoster.rawCopies({name:target.name, count:1, elite:1});
    const promotions = Math.max(0, target.elite-have.elite);
    const normalNeeded = Math.max(0, target.count - have.elite - promotions);
    return {name:target.name, qty:Math.max(0, promotions*cost + normalNeeded - (have.count-have.elite)),
      promotions, plain:have.count-have.elite, cost, tier:W.rawOps[target.name]?.tier};
  }
  function gapAdvice(gap, source, action) {
    const recruit = Planning.recruitment(gap.name);
    const later = recruit.canRoll === false && recruit.minTerminal > db.run.terminal;
    const text = gap.promotions && gap.plain
      ? `已持有 ${gap.plain} 名普通，再取 ${gap.cost-gap.plain} 名可合成 1 名精锐。`
      : gap.promotions ? `目标还需合成 ${gap.promotions} 名精锐。` : "";
    const title = later ? (recruit.kind === "custom" ? `${gap.name}须先开自选档位` : `${gap.name}要到 ${recruit.minTerminal} 本再找`)
      : db.run.money === 0 ? `本轮余额已用完 · 待补${gap.name}` : `商店遇到时优先拿${gap.name}`;
    return card(title, `${source}还缺 ${gap.name} ×${gap.qty}。${text}${later ? "当前终端刷不到。" : ""}${cashHint(later)}`, action);
  }
  function unavailable(name) {
    const op = W.rawOps[name];
    return !op || W.isBanned(name) || (op.isCustom && !db.prefs.custom.includes(name) && !db.run.counts[name]);
  }
  function general(held) {
    const sameBond = new Map();
    for (const u of held) {
      const op = W.rawOps[u.name];
      for (const b of new Set([...op.coreCovenants, ...op.additionalCovenants])) {
        if (!sameBond.has(b)) sameBond.set(b, []);
        sameBond.get(b).push(u.name);
      }
    }
    // Match by distinct names in the pool. Deployment, gear and strategy can change the actual covenant level.
    const bonds = [...sameBond].sort((a,b)=>b[1].length-a[1].length);
    const candidates = Object.values(W.rawOps).filter(op => !db.run.counts[op.name] &&
      !unavailable(op.name) && !op.isCustom && !op.requiredStrategyId);
    let future;
    for (const [bond, mates] of bonds) {
      const shop = candidates.filter(op => op.coreCovenants.includes(bond) || op.additionalCovenants.includes(bond))
        .sort((a,b)=>a.tier-b.tier);
      const op = shop.find(o=>Planning.recruitment(o.name).canRoll === true);
      if (op) return card(db.run.money === 0 ? `本轮余额已用完 · 待补${op.name}` : `本轮遇到${op.name}可作过渡`,
        `${op.tier} 阶，与已持有的${mates.slice(0,2).join("、")}同属${bond}，可试着一起上场。${cashHint()}`,
        button("basket-tab","看推荐阵容","linkbtn",attr("tab","recommend")));
      if (!future && shop.length) future = {op:shop[0],bond};
    }
    if (future) return card(`想补${future.bond}，${future.op.tier} 本起可找${future.op.name}`,
      "本级暂无可直接买入的未持有同盟约干员。"+cashHint(true));
    return card("先确认本局目标", "在推荐阵容里选想玩的方向，再按本阶段补人。"+cashHint(),
      button("basket-tab","看推荐阵容","linkbtn",attr("tab","recommend")));
  }
  function pairs(held) {
    return held.filter(u => u.count-u.elite === QuickRoster.rawCopies({name:u.name,count:1,elite:1})-1 &&
      Planning.recruitment(u.name).canRoll === true);
  }
  function fallback(held, team) {
    const match = team ? null : RunLineups.bestMatch();
    const guide = team || match?.guide;
    const stage = guide?.stages[team ? stageNum(team) : match.index];
    const more = button("basket-tab", "看推荐阵容", "linkbtn", attr("tab","recommend"));
    if (!stage) {
      const pair = pairs(held)[0];
      if (pair) return gapAdvice(missing({name:pair.name,count:pair.elite+1,elite:pair.elite+1}), "若想合精锐，", more);
      return general(held);
    }
    const action = match ? button("follow-run-lineup", "跟踪这套阵容", "linkbtn",
      attr("origin",match.origin)+" "+attr("id",guide.id)+" "+attr("index",match.index)) : W.act("owned","更新持有","linkbtn");
    const entries = QuickRoster.fromStage(stage);
    const gaps = entries.filter(u=>!unavailable(u.name)).map(missing).filter(g=>g.qty>0);
    // Only normal shop candidates are offered as purchases. Strategy grants require a separate action.
    const candidate = gaps.find(g=>Planning.recruitment(g.name).canRoll === true) || gaps
      .filter(g=>Planning.recruitment(g.name).minTerminal > db.run.terminal).sort((a,b)=>a.tier-b.tier)[0];
    if (candidate) return gapAdvice(candidate, `「${guide.title}」${stage.label || "当前阶段"}`, action);
    const blocked = entries.filter(u=>unavailable(u.name));
    if (blocked.length) return card("先换掉本局不可用人选", blocked.map(u=>u.name).join("、")+" 无法补入这套阵容。",
      team ? W.act("team-review","预览阵容修补","linkbtn") : more);
    if (gaps.length) return card("先核对人选的获取方式", gaps.map(g=>g.name+" · "+Planning.recruitment(g.name).status).join("、")+"。"+cashHint(), action);
    if (!entries.length) return card("先选本阶段干员", "当前阶段没有干员目标。"+cashHint(), more);
    return card("本阶段干员已齐，核对上场与站位", `「${guide.title}」${stage.label || ""}的数量和精锐要求均已满足。${cashHint(true)}`, action);
  }
  function savedAdvice(team, held) {
    const archive = team.autoPlan, route = archive.savedRoute;
    const rosterChanged = team.stages.length !== route.stages.length || route.stages.some((s,i)=>{
      const entries = team.stages[i].entries.filter(e=>e.key.startsWith("op:"));
      return entries.length !== s.operators.length || entries.some((e,j)=>e.key !== "op:"+s.operators[j].name || e.elite);
    });
    if (rosterChanged) {
      adviceJob = null;
      return fallback(held, team) + '<p class="hint">阵容已修改，按当前阶段核对购买需求。</p>';
    }
    const blocked = [...new Set(route.stages.flatMap(s=>s.operators.map(o=>o.name)))].filter(unavailable);
    if (W.coreBanned(archive.candidate.mainCovenant) || blocked.length) {
      adviceJob = null;
      return card("先修补这套自动路线", "本局不可用：" + (blocked.join("、") || archive.candidate.mainCovenant) + "。", W.act("team-review","预览阵容修补","linkbtn"));
    }
    const req = {...W.request(), ...archive, owned:held.map(u=>u.name)};
    const final = team.stages[stageNum(team)]?.isFinal === true;
    const key = JSON.stringify([db.run.terminal,db.run.round,req.money,req.upgrade,req.owned,final]);
    if (adviceJob?.archive === archive && adviceJob.key === key) return adviceJob.html;
    const job = adviceJob = {archive, key, html:card("正在读取本局路线建议",cashHint())};
    // Yield until the current tap is painted. A newer render replaces this job.
    setTimeout(async () => {
      if (job !== adviceJob) return;
      try {
        const advice = await W.engine("advice", req);
        if (job !== adviceJob) return;
        const levels = advice.flatMap(stage=>stage.levels || []);
        const level = levels.find(l=>l.terminalLevel === (final ? 0 : req.terminal));
        if (!level) job.html = fallback(held, team);
        else {
          const priorities = (level.keyCards || []).filter(n=>!W.isBanned(n));
          const first = priorities[0], reserve = level.reserve?.[0];
          const heading = first ? (req.money === 0 ? "本轮余额已用完 · 待补" : "商店遇到时优先拿") + first : level.focus;
          const budget = final ? cashHint() : level.economyText;
          job.html = card(heading, [first && level.focus, level.upgradeText, budget,
            reserve && `有余钱时可留${reserve.name}，${reserve.neededAt}用。`].filter(Boolean).join(" ")) +
            (level.purchaseText ? `<details><summary>本级购买顺序</summary><p>${esc(level.purchaseText).replaceAll("\n","<br>")}</p></details>` : "");
        }
      } catch {
        if (job !== adviceJob) return;
        job.html = fallback(held,team);
      }
      for (const el of document.querySelectorAll("[data-next-route]")) el.innerHTML = job.html;
    }, 60);
    return job.html;
  }
  function view() {
    const held = QuickRoster.owned().filter(u=>!W.isBanned(u.name)), team = active();
    let body;
    if (held.length && team?.autoPlan?.candidate && team.autoPlan.savedRoute?.stages?.length) {
      body = `<div data-next-route>${savedAdvice(team,held)}</div>`;
    } else {
      adviceJob = null;
      body = held.length ? fallback(held,team) : card(`当前 ${db.run.terminal} 本 · 先看本级商店`,
        levelTip(db.run.terminal) + "点「快调干员」记录已有干员，可查看具体补牌和精锐建议。",
        W.act("owned","快调干员","linkbtn"));
    }
    const close = pairs(held);
    const promotion = close.length ? `<p class="hint">精锐机会 · ${esc(close.slice(0,3).map(u=>u.name).join("、"))}再各拿 1 名普通即可合成精锐。</p>` : "";
    return `<section class="next-step"><h3>下一步做什么</h3>${body}${promotion}${held.length ? `<p class="hint">本级通用 · ${esc(levelTip(db.run.terminal))}</p>` : ""}</section>`;
  }
  function progression() {
    const byLevel = Array.from({length:6},()=>new Set());
    for (const t of Teams.tracked()) {
      const current = stageNum(t);
      // Put the active stage first when more than three targets open at the same level.
      for (const stage of [t.stages[current], ...t.stages.filter((_,i)=>i !== current)]) {
        if (!stage) continue;
        for (const e of stage.entries) {
          if (!e.key.startsWith("op:")) continue;
          const name = e.key.slice(3);
          if (db.run.counts[name] > 0 || unavailable(name)) continue;
          const recruit = Planning.recruitment(name);
          if (recruit.kind === "shop") byLevel[recruit.minTerminal-1].add(name);
        }
      }
    }
    const rows = byLevel.map((names,i) => {
      const level = i+1;
      const picks = names.size ? `<br><small>本级起可找 · ${esc([...names].slice(0,3).join("、"))}</small>` : "";
      return `<li data-progression-level="${level}"><strong>${level} 本</strong><div>${esc(levelTip(level))}${picks}</div></li>`;
    }).join("");
    return `<details class="plan-progression"><summary>各本怎么走</summary><ol>${rows}</ol></details>`;
  }
  return {view, progression};
})();
