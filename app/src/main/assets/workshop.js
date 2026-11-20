"use strict";
const Workshop = (() => {
  const W=Workbench, benchBonds=new Set(["远见","奇迹","投资人"]);
  let kind="op", tier=0, bond="", picked=-1, addBench=false, focusStage=null, draft=null;
  function freshTeam() {
    let n=db.teams.length+1;
    while(db.teams.some(t=>t.title==="推演阵容 "+n)) n++;
    return {title:"推演阵容 "+n,stage:0,stages:["前期","中期","成型"].map(label=>({label,...GuideModel.defaultRange(label),entries:[]}))};
  }
  function team() { return active() || (draft ||=freshTeam()); }
  function save(t) {
    if (!t.id) {
      const index=picked; draft=null; const stored=incorporate(t,t.stage,[],"planner");
      focusStage=stored.stages[stageNum(stored)]; picked=index; render();
    }
    else { persist(); render(); renderBasket(); }
  }
  const act=(a,text,v,cls="btn light")=>W.act("workshop-"+a,text,cls,v);
  function cap(){return db.planning.people || db.board?.people || 8;}
  function bondsFor(s) {
    const members=new Map(), deputyForms=new Set(), disabled=new Set(W.effectiveBonds());
    let fieldElite=0;
    for (const e of s.entries.filter(e=>e.key.startsWith("op:"))) {
      const n=e.key.slice(3), op=W.rawOps[n];
      if (!op || W.isBanned(n)) continue;
      if (!e.reserve && e.elite) fieldElite++;
      const all=new Set([...op.coreCovenants,...op.additionalCovenants]);
      if (e.equipment?.includes("变形同构体"))
        for(const gear of e.equipment) if(W.equipmentChanges[gear]) all.add(W.equipmentChanges[gear]);
      for(const b of all) {
        if (e.reserve && !benchBonds.has(b)) continue;
        if (!members.has(b)) members.set(b,new Set());
        members.get(b).add(n);
        if(b==="助力") deputyForms.add(n+(e.elite?"/精":""));
      }
    }
    const harmony=members.has("调和") && !disabled.has("调和");
    return W.data.covenants.covenants.map(c=>{
      let count=members.get(c.name)?.size || 0;
      if(count && c.bondType==="SEASON" && harmony) count++;
      if(c.name==="绝技") count=fieldElite;
      const tiers=W.data.multiplayer_thresholds[c.name] || [c.activateCount];
      if(c.name==="助力" && count>=tiers[0]) count=deputyForms.size;
      const off=disabled.has(c.name), solo=c.name==="独行" && count>1;
      const level=off || solo ? 0 : tiers.filter(n=>count>=n).length;
      const target=tiers[level] || tiers[tiers.length-1];
      const status=off?"本局禁用":solo?"只能上场 1 名独行":level===tiers.length?"已激活":level?"已激活 · 下档差 "+(target-count)+" 人":"还差 "+(target-count)+" 人";
      return {...c,count,level,target,status};
    }).filter(c=>c.count>0).sort((a,b)=>b.level-a.level || b.count-a.count);
  }
  function library() {
    const list=Object.entries(catalogue).filter(([k,o])=>o.kind===kind && (!tier || o.tier===tier) &&
      (kind!=="op" || ((!o.custom || db.prefs.custom.includes(o.name)) && !W.isBanned(o.name) && (!bond || o.tags.includes(bond)))));
    const modes=Object.entries(W.data.multiplayer_bans).map(([id,m])=>[id,m.name]);
    if (!W.data.multiplayer_bans[db.run.mode]) modes.unshift(["","选择多人难度"]);
    return `<aside class="ws-library">${section("干员与装备库",W.act("ban-bonds","本局 Ban · "+W.effectiveBonds().length,"linkbtn"))}
      <label class="ws-mode">多人难度 ${W.select("ws-mode",modes,db.run.mode)}</label><div class="segments">${["op","eq"].map((k,i)=>act("kind",["干员","装备"][i],k,k===kind?"chosen":"")).join("")}</div>
      <div class="ws-tiers">${[0,1,2,3,4,5,6].map(n=>act("tier",n || "全部",n,n===tier?"chip chosen":"chip")).join("")}</div>
      ${kind==="op" ? W.select("ws-bond",[["","全部盟约"],...W.data.covenants.covenants.map(b=>b.name)],bond) : '<p class="hint">先点中间的干员，再点装备穿戴。</p>'}
      <div class="ws-library-grid">${list.map(([k,o])=>`<button type="button" data-w="workshop-add" data-v="${esc(k)}">${portrait(k)}<strong>${esc(o.name)}</strong><small>${o.tier} 阶</small></button>`).join("") || "没有符合筛选的项目"}</div></aside>`;
  }
  function slots(s,reserve) {
    return s.entries.map((e,i)=>{
      if (!e.key.startsWith("op:") || !!e.reserve!==reserve) return "";
      const n=e.key.slice(3);
      return `<div class="ws-card"><button type="button" class="ws-piece" data-w="workshop-pick" data-v="${i}" aria-pressed="${picked===i}">
        ${portrait(e.key)}<strong>${esc(n)}</strong><small>${W.isBanned(n)?"本局禁用":e.elite?"精锐":"普通"} · ${esc(Planning.recruitment(n).label)}</small>
        ${e.equipment?.length?`<small>${esc(e.equipment.join("、"))}</small>`:""}</button>${QuickRoster.cardActions("workshop",i,n,!!e.elite,!reserve)}</div>`;
    }).join("");
  }
  function render() {
    document.body.classList.add("workshop-open");
    const t=team(), index=stageNum(t), s=t.stages[index];
    if (s!==focusStage) {picked=-1;focusStage=s;}
    const current=s.entries[picked], all=s.entries.filter(e=>e.key.startsWith("op:")), field=all.filter(e=>!e.reserve).length;
    const bonds=bondsFor(s);
    const previousScroll=desk.querySelector(".ws-library-grid")?.scrollTop || 0;
    desk.innerHTML=Planning.tabs("workshop")+ `<div class="ws-layout">${library()}<section class="ws-stage">
      <div class="ws-team">${W.select("ws-team",t.id?db.teams.map(g=>[g.id,g.title]):[["",t.title]],t.id || "")}${act("new","新阵容","")}${W.act("team-import","导入","linkbtn")}${t.id?W.act("team-share","分享","linkbtn"):""}</div>
      <div class="ws-stages">${t.stages.map((a,i)=>act("stage",GuideModel.stageText(a),i,i===index?"chip chosen":"chip")).join("")}</div>
      <div class="ws-toolbar">${act("position","查看站位","")}<span>第 ${db.run.round} / ${GuideModel.maxRound} 回合 · ${db.run.terminal} 本</span></div>
      <p class="unit-key">＋1 加一份　精 标记精锐　✓ 上场 / 下场　× 删这一份</p>
      ${section("上场 · "+field+" / "+cap(),act("dest",addBench?"加到上场":"✓ 加到上场","field","linkbtn"))}
      <div class="ws-slots">${slots(s,false)||'<p class="hint">点左侧干员加入上场阵容。</p>'}</div>
      ${section("整备区 · "+(all.length-field)+" / 10",act("dest",addBench?"✓ 加到整备":"加到整备","bench","linkbtn"))}
      <div class="ws-slots">${slots(s,true)||'<p class="hint">可点选上场干员移入整备区。</p>'}</div>
      ${current?.key.startsWith("op:") ? `<div class="ws-inspector"><b>${esc(current.key.slice(3))}</b><div class="actions">${act("gear","配装备","")}</div>${(current.equipment||[]).map((g,i)=>act("unequip","卸下 "+g,i,"chip")).join("")}</div>`:""}
      </section><aside class="ws-bonds">${section("盟约一览")}<p class="hint">已激活 ${bonds.filter(b=>b.level).length} · 整备区计入远见、奇迹、投资人</p>
      ${bonds.map(b=>`<button data-w="reference" data-v="${esc(b.name)}"><b>${esc(b.name)}</b><span>${b.count} / ${b.target} · ${esc(b.status)}</span></button>`).join("")}
      ${section("本回合资金")}<p>${db.run.money==null?"余额待选":"余额 "+db.run.money} · 道具 +${ItemIncome.total(db.run)}</p>${W.act("income-open","记录道具收入","btn light")}</aside></div>`;
    desk.querySelector(".ws-library-grid").scrollTop=previousScroll;
  }
  function click(a,v) {
    const t=team(), s=t.stages[stageNum(t)], entries=s.entries;
    let destination=addBench;
    if(a.startsWith("card-")) {
      picked=Number(v);
      const card=entries[picked];
      if(!card?.key.startsWith("op:")) return;
      if(a==="card-copy") {a="add";v=card.key;destination=true;}
      else a=a==="card-field"?"move":a.slice(5);
    }
    const e=entries[picked];
    if (a==="new") {incorporate(freshTeam(),0,[],"planner");return;}
    if (a==="position") {
      if(!active() || !entries.some(e=>e.key.startsWith("op:")&&!e.reserve&&!W.isBanned(e.key.slice(3)))) { toast("先加入本局可用的上场干员");return; }
      Maps.openWorkshop(t); return;
    }
    if (a==="stage") { t.stage=Number(v); if(t.id) persist(); render();renderBasket();return; }
    if (a==="kind") kind=v;
    else if (a==="tier") tier=Number(v);
    else if (a==="dest") addBench=v==="bench";
    else if (a==="pick") picked=Number(v);
    else if (a==="gear") {kind="eq";tier=0;}
    else {
      const room=reserve=>entries.filter(x=>x.key.startsWith("op:") && !!x.reserve===reserve).length < (reserve?10:cap());
      if (a==="add" && v.startsWith("eq:")) {
        if (!e) {toast("先点一名要穿戴装备的干员");return;}
        const capacity=e.key==="op:“暴躁铁皮”"?(e.elite?6:4):2;
        if ((e.equipment||[]).length>=capacity) {toast("装备栏已满，请先卸下一件");return;}
        (e.equipment ||= []).push(v.slice(3));
      } else if (a==="add") {
        if (W.isBanned(v.slice(3))) {toast("本局无法招募该干员");return;}
        const ordinary=entries.filter(x=>x.key===v&&!x.elite);
        const need=QuickRoster.mergeSize(v.slice(3));
        ordinary.sort((a,b)=>Number(!!a.reserve)-Number(!!b.reserve));
        if (ordinary.length>=need-1) {
          const [first,...consumed]=ordinary.slice(0,need-1); first.elite=true;
          for(const unit of consumed) {
            entries.splice(entries.indexOf(unit),1);
            for(const name of unit.equipment||[]) entries.push({key:"eq:"+name});
          }
          picked=entries.indexOf(first);
        } else {
          if (!room(destination)) {toast(destination?"整备区已满":"上场已满，可切换到整备区");return;}
          picked=entries.push({key:v,reserve:destination})-1;
        }
      } else if (!e) return;
      else if(a==="move") {
        if (!room(!e.reserve) || (e.reserve && W.isBanned(e.key.slice(3)))) {toast("目标区域已满或干员已禁用");return;}
        e.reserve=!e.reserve;
      } else if(a==="elite") {
        if(e.elite && entries.filter(x=>x.key===e.key&&!x.elite).length>=QuickRoster.rawCopies({name:e.key.slice(3),count:1,elite:1})-1) {toast("普通份数已达合成阈值");return;}
        e.elite=!e.elite;
      } else if(a==="remove") {entries.splice(picked,1);picked=Math.min(picked,entries.length-1);}
      else if(a==="unequip") e.equipment.splice(Number(v),1);
      else return;
      save(t);return;
    }
    render();
  }
  document.addEventListener("change",ev=>{
    if(ev.target.id==="ws-mode") {void Planning.click("plan-mode",ev.target.value);}
    if(ev.target.id==="ws-team"){db.active=ev.target.value;persist();render();renderBasket();}
    if(ev.target.id==="ws-bond"){bond=ev.target.value;render();}
  });
  return {render,click};
})();
