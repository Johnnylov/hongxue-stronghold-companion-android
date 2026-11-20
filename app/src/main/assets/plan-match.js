"use strict";
const PlanMatch = (() => {
  const W = Workbench;
  function holdings() {
    return QuickRoster.owned().filter(u => W.rawOps[u.name] && !W.isBanned(u.name));
  }
  function weights(held) {
    return Object.fromEntries(held.map(u => [u.name, 4 + (u.elite ? 3 : 0) + (u.count - u.elite >= 2 ? 1 : 0)]));
  }
  function price(name) {
    const op = W.rawOps[name];
    // Both optional custom slots use the same base price.
    return op ? W.data.economy.recruitPrices[op.isCustom ? 5 : op.tier] : Infinity;
  }
  function mainHolder(name, core) {
    return W.rawOps[name]?.coreCovenants.includes(core);
  }
  function rank(candidates, req) {
    const held = holdings();
    return candidates.map((candidate,index) => {
      const core = candidate.mainCovenant, members = candidate.final.operators.map(o=>o.name);
      const keep = held.filter(u=>members.includes(u.name));
      const native = held.filter(u=>mainHolder(u.name,core));
      const missing = members.filter(n=>!req.preferred[n]);
      let access = 0;
      for (const name of missing) {
        const now = Planning.recruitment(name,req.terminal);
        if (now.canRoll === true) {
          access += req.money == null || req.money >= price(name) ? 1 : 0;
        } else if (req.terminal < 6 && req.upgrade != null && req.money != null &&
          req.money >= req.upgrade + price(name) && Planning.recruitment(name,req.terminal+1).canRoll === true) {
          access += 0.5;
        } else {
          access -= 1;
        }
      }
      // Native holders anchor the direction. Final members reduce rebuilding, especially elites.
      // Among similarly supported directions, favor purchases within this round's reach.
      const fit = native.length*6 + keep.reduce((v,u)=>v+req.preferred[u.name],0) + access;
      const score = (candidate.score || 0)/20 + (held.length ? fit : 0);
      return {candidate,index,keep,native,missing,score,held};
    }).sort((a,b)=>b.score-a.score || a.index-b.index);
  }
  function turn(plan, req) {
    const {terminal, money, upgrade} = req, next = terminal+1;
    const {candidate,held,missing} = plan, core = candidate.mainCovenant;
    const hasRole = (n,r) => W.profiles[n]?.roles?.includes(r);
    const hasTank = held.some(u=>hasRole(u.name,"盾位")), hasHeal = held.some(u=>hasRole(u.name,"奶位"));
    const merge = plan.keep.filter(u=>u.count-u.elite === QuickRoster.rawCopies({name:u.name,count:1,elite:1})-1);
    const targets = [...new Set([...merge.map(u=>u.name), ...missing])].filter(n=>W.rawOps[n] && !W.isBanned(n));
    function importance(n) {
      return (merge.some(u=>u.name===n) ? 12 : 0) + (!hasTank && hasRole(n,"盾位") ? 8 : 0) +
        (terminal >= 3 && !hasHeal && hasRole(n,"奶位") ? 8 : 0) + (mainHolder(n,core) ? 4 : 0);
    }
    targets.sort((a,b)=>importance(b)-importance(a) || price(a)-price(b));
    const here = targets.filter(n=>Planning.recruitment(n,terminal).canRoll === true);
    const opens = missing.filter(n=>Planning.recruitment(n,terminal).canRoll !== true && Planning.recruitment(n,next).canRoll === true);
    const affordable = here.find(n=>money == null || price(n)<=money);
    const funding = money == null ? "余额待点选" : (req.estimated?"估算余额 ":"当前余额 ") + money;
    const costText = terminal === 6 ? "终端已满级" : upgrade == null ? "升级价待确认" :
      money == null ? "升本需 " + upgrade : money < upgrade ? "升本还差 " + (upgrade-money) : "升本后余 " + (money-upgrade);
    const budget = funding + " · " + costText + "。";
    const unlock = opens.length ? "可开始找" + opens.slice(0,2).join("、") + "。" : "";
    const canUp = terminal < 6 && upgrade != null && money != null && money >= upgrade;
    const last = req.round===GuideModel.maxRound;
    if (terminal < 6 && upgrade === 0) return ["先免费升至 "+next+" 本", unlock+"本轮升本消耗 0 资金。"];
    if (canUp && opens.length && (!last || money-upgrade >= price(opens[0])) && (!affordable || (importance(affordable)<8 && money-upgrade >= price(opens[0]))))
      return ["建议先升至 "+next+" 本", "若现有阵容能守，"+unlock+"升本消耗 "+upgrade+"，本轮余 "+(money-upgrade)+"。"];
    if (affordable) {
      const reason = merge.some(u=>u.name===affordable) ? "再拿一名可合精锐。" :
        !hasTank && hasRole(affordable,"盾位") ? "持有池需要阻挡位。" :
        terminal>=3 && !hasHeal && hasRole(affordable,"奶位") ? "持有池需要治疗位。" :
        mainHolder(affordable,core) ? "可补入"+core+"核心阵容。" : "可直接用于成型阵容。";
      return ["本轮遇到时先拿"+affordable, reason+"常规招募价 "+price(affordable)+"，"+budget];
    }
    if (!last && canUp && (opens.length || missing.some(n=>Planning.recruitment(n).minTerminal>terminal)))
      return ["建议先升至 "+next+" 本", "若当前阵容能守，可向高阶目标推进。"+unlock+budget];
    if (money === 0) return ["本轮先调站位", budget+(last?"末轮核对阻挡与治疗。":"有目标牌在架上时可冻结。")];
    if (here.length) return ["本轮先留在 "+terminal+" 本", here[0]+" 常规招募价 "+price(here[0])+"，若店内有折扣可按实价拿牌。"+budget];
    if (terminal<6 && (money==null || upgrade==null)) return ["先核对升本预算",unlock+budget];
    return [missing.length ? "本轮先留在 "+terminal+" 本，检查商店与站位" : "成型干员已齐，先检查站位",unlock+budget];
  }
  function levelAction(level,req) {
    const buy=(level.keyCards || []).find(n=>!W.isBanned(n) && Planning.recruitment(n,req.terminal).canRoll===true && (req.money==null || price(n)<=req.money));
    if(req.money===0 && req.upgrade!==0) return "本轮先调站位";
    if(req.terminal<6 && req.upgrade===0) return "可免费升至 "+(req.terminal+1)+" 本";
    if(level.pace===0 && req.upgrade!=null && req.money!=null && req.money>=req.upgrade) return "若能守住，本轮可先升至 "+(req.terminal+1)+" 本";
    if(buy) return "本轮遇到时先拿"+buy;
    return level.title+" · 核对本级缺口";
  }
  function summary(plan,req,level,first=true) {
    let [action,reason] = turn(plan,req);
    if (level) {
      action=levelAction(level,req);
      reason=(req.money==null?"余额待确认":(req.estimated?"估算余额 ":"当前余额 ")+req.money)+(req.upgrade!=null?" · 升本需 "+req.upgrade:"")+"。";
    }
    const retained = plan.keep.map(u=>u.name+(u.elite?"（精锐）":"")).join("、");
    return `<section class="match-choice"><h3>${!first ? "所选路线" : plan.held.length ? "本局首选" : "通用参考"} · ${esc(plan.candidate.mainCovenant)}</h3>
      <p>${plan.held.length ? "成型可沿用 "+plan.keep.length+" 名"+(retained ? " · "+esc(retained) : "") : "录入已持有的干员后，按本局重新选择首选阵容。"}</p>
      ${req.estimated ? `<p class="hint">预算按本回合开局未消费 ${esc(req.money)} 资金估算，可在对局设置点选实际余额。</p>` : ""}
      <strong>${esc(action)}</strong><p>${esc(reason)}</p></section>`;
  }
  return {holdings,weights,rank,summary,levelAction,price};
})();
