"use strict";
const ItemIncome = (() => {
  // Values and trigger timing from the regulation season's equipment descriptions.
  const items = [
    {name:"盟约之币", timing:"即时", normal:[1,1], elite:[2,2]},
    {name:"精打细算玩偶", timing:"以后每回合", normal:[1,1], elite:[2,2]},
    {name:"见钱眼开玩偶", timing:"下回合", normal:[2,2], elite:[4,4]},
    {name:"驮兽储蓄罐", timing:"即时", normal:[1,6], elite:[2,12]},
    {name:"定期存折", timing:"即时", normal:[0,20]},
    {name:"其他实际到账", timing:"即时", normal:[1,20]}
  ];
  function due(e,round) {
    if (e.timing === "下回合") return round === e.round+1;
    if (e.timing === "以后每回合") return round > e.round;
    return round === e.round;
  }
  function total(r,after=0) {
    return (r.incomeItems || []).reduce((sum,e)=>sum+(e.id>after && due(e,r.round) ? e.amount : 0),0);
  }
  function confirmBalance(r,value) {
    r.money=Economy.balance(value);
    r.incomeAnchor = r.money==null ? null : {round:r.round, amount:r.money, after:r.incomeSequence || 0};
  }
  function anchor(r) {
    if (r.money!=null && r.incomeAnchor?.round !== r.round) confirmBalance(r,r.money);
  }
  function apply(r) {
    const base=r.incomeAnchor;
    if (base && r.money!=null && base.round===r.round) r.money=Economy.balance(base.amount+total(r,base.after));
    persist(); close(); render();
  }
  function record(item, variant, amount) {
    const range=item?.[variant];
    if (!range || !Number.isInteger(amount) || amount<range[0] || amount>range[1]) return;
    const r=db.run;
    anchor(r);
    r.incomeSequence=(r.incomeSequence || 0)+1;
    (r.incomeItems ||= []).push({id:r.incomeSequence,name:item.name,variant,timing:item.timing,round:r.round,amount});
    apply(r);
  }
  function open() {
    const W=Workbench;
    const choices=items.map((item,index)=>{
      const buttons=["normal","elite"].filter(v=>item[v]).map(v=>{
        const [low,high]=item[v], value=low===high ? "+"+low : "点选到账数";
        return W.act("income-pick", (item.elite?(v==="normal"?"普通 ":"精锐 "):"")+value,"chip",index+"/"+v);
      }).join("");
      return `<div class="income-row"><b>${esc(item.name)}</b><small>${esc(item.timing)}</small>${buttons}</div>`;
    }).join("");
    const history=[...(db.run.incomeItems || [])].reverse().map(e=>`<div class="income-row"><span>第 ${esc(e.round)} 回合 · ${esc(e.name)}${e.variant==="elite"?"（精锐）":""} · ${esc(e.timing)} +${esc(e.amount)}</span>${W.act("income-undo","撤销","linkbtn",e.id)}</div>`).join("");
    popup(`<h2>记录道具收入</h2><p>第 ${db.run.round} 回合 · 道具生效时点一次。两种玩偶从下回合开始计入。</p>${choices}${history ? section("本局记录")+history : ""}`);
  }
  function click(a,v) {
    if (a==="income-open") { open(); return; }
    const r=db.run;
    if (a==="income-undo") {
      anchor(r); r.incomeItems=(r.incomeItems || []).filter(e=>e.id!==Number(v)); apply(r); return;
    }
    const [index,variant,n]=v.split("/"), item=items[Number(index)], range=item?.[variant];
    if (!range) return;
    if (a==="income-amount") { record(item,variant,Number(n)); return; }
    if (range[0]===range[1]) { record(item,variant,range[0]); return; }
    const amounts=Array.from({length:range[1]-range[0]+1},(_,i)=>Workbench.act("income-amount","+"+(i+range[0]),"chip",v+"/"+(i+range[0]))).join("");
    popup(`<h2>${esc(item.name)} · 实际到账</h2><div class="income-values">${amounts}</div>${Workbench.act("income-open","返回","linkbtn")}`);
  }
  return {total,confirmBalance,click};
})();
