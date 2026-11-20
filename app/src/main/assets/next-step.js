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
  function routeResult(title,route,advice,final=false) {
    const preview=!final && db.run.terminal<route.stages[0].definition.terminalLevel;
    let opening="";
    if(preview) {
      const cost=Economy.price(db.run,W.data.economy);
      const amount=db.run.money;
      const budget=cost==null?"升级价待确认":`升到 2 本需 ${cost} 资金`+(amount==null?"":amount<cost?`，还差 ${cost-amount}`:`，升后余 ${amount-cost}`);
      const early=route.stages[0].operators.filter(o=>Planning.recruitment(o.name).canRoll===true && !db.run.counts[o.name]);
      opening=`<p class="route-opening"><b>当前 1 本</b>　${early.length?"遇到"+esc(early.map(o=>o.name).join("、"))+"可先拿。":"先用现有一阶干员过渡。"}${esc(budget)}。</p>`;
    }
    return `<p class="route-source">${esc(title)}</p>`+opening+Planning.routePanel(route,advice,db.run.terminal,final);
  }
  function cachedAdvice(owner,key,load,onError) {
    if(adviceJob && adviceJob.owner===owner && adviceJob.key===key) return adviceJob.html;
    const job=adviceJob={owner,key,html:'<p role="status">正在计算本局路线…</p>'};
    setTimeout(async()=>{
      if(job!==adviceJob) return;
      if(db.page!=="map") {adviceJob=null;return;}
      try {job.html=await load();}
      catch {job.html=onError()+'<p>路线暂未算出。</p>'+W.act("next-retry","重新计算","linkbtn");}
      if(job!==adviceJob) return;
      for(const el of document.querySelectorAll("[data-next-route]")) el.innerHTML=job.html;
    },180);
    return job.html;
  }
  function liveAdvice(team,held) {
    const req=Planning.payload("auto");
    const cores=W.data.covenants.covenants.filter(c=>c.bondType==="SEASON").map(c=>c.name);
    const preferred=team && (team.autoPlan?.candidate?.mainCovenant || Object.keys(team.goals || {}).find(n=>cores.includes(n)) ||
      (team.tags || []).find(n=>cores.includes(n)) || cores.find(n=>team.title.includes(n)));
    const key=JSON.stringify([req.round,req.terminal,req.money,req.estimated,req.upgrade,req.modeId,req.people,req.strategy,req.mechElite,
      req.owned,req.preferred,req.banned,req.bannedBonds,req.custom,preferred]);
    return cachedAdvice(team,key,async()=>{
      const result=await Planning.matchRoute(req,preferred);
      return routeResult((held.length?"本局推荐 · ":"通用路线 · ")+result.title,result.route,result.advice);
    },()=>fallback(held,team));
  }
  function savedAdvice(team, held) {
    const archive = team.autoPlan, route = archive.savedRoute;
    const rosterChanged = team.stages.length !== route.stages.length || route.stages.some((s,i)=>{
      const names=team.stages[i].entries.filter(e=>e.key.startsWith("op:") && !e.reserve).map(e=>e.key.slice(3)).sort();
      const planned=s.operators.map(o=>o.name).sort();
      return names.length!==planned.length || names.some((n,j)=>n!==planned[j]);
    });
    if (rosterChanged) {
      return liveAdvice(team,held);
    }
    const blocked = [...new Set(route.stages.flatMap(s=>s.operators.map(o=>o.name)))].filter(unavailable);
    if (W.coreBanned(archive.candidate.mainCovenant) || blocked.length) {
      adviceJob = null;
      return card("先修补这套自动路线", "本局不可用：" + (blocked.join("、") || archive.candidate.mainCovenant) + "。", W.act("team-review","预览阵容修补","linkbtn"));
    }
    const req = {...W.request(), ...archive, owned:held.map(u=>u.name)};
    const final = team.stages[stageNum(team)]?.isFinal === true;
    const key = JSON.stringify([db.run.terminal,db.run.round,req.money,req.upgrade,req.owned,final]);
    return cachedAdvice(archive,key,async()=>{
      const advice=await W.engine("advice",req);
      return routeResult("跟踪路线 · "+team.title,route,advice,final);
    },()=>fallback(held,team));
  }
  function view() {
    const held=PlanMatch.holdings(), team=active();
    const saved=team?.autoPlan?.candidate && team.autoPlan.savedRoute?.stages?.length;
    const html=saved?savedAdvice(team,held):liveAdvice(team,held);
    // Guide shopping and desktop-generated routes may have different members. Keep their identities visible.
    const shopping=!saved && team && held.length
      ? `<details class="next-shopping"><summary>已跟踪清单 · ${esc(team.title)}</summary>${fallback(held,team)}</details>`:"";
    const match=!team && held.length && RunLineups.bestMatch();
    const follow=match?button("follow-run-lineup","跟踪攻略 · "+match.guide.title,"linkbtn",
      attr("origin",match.origin)+" "+attr("id",match.guide.id)+" "+attr("index",match.index)):"";
    const close=pairs(held);
    return `<details class="next-step" id="next-step-panel" ${db.prefs.mapAdviceOpen===false?"":"open"}><summary><b>下一步做什么</b> · 当前 ${db.run.terminal} 本</summary><div class="next-heading">${W.act("owned","调整持有","linkbtn")}</div>
      <div data-next-route>${html}</div>${close.length?`<p>再拿一份可合精锐 · ${esc(close.map(u=>u.name).join("、"))}</p>`:""}${shopping}${follow}</details>`;
  }
  document.addEventListener("toggle",e=>{
    const panel=e.target;
    if(panel.id!=="next-step-panel" || !panel.isConnected || panel.open===(db.prefs.mapAdviceOpen!==false)) return;
    db.prefs.mapAdviceOpen=panel.open;
    persist();
  },true);
  function retry() {adviceJob=null;Maps.render();}

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
  return {view, progression, retry};
})();
