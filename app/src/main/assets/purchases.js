"use strict";
// Keep the shop's physical slots, including duplicate copies of the same operator.
const Purchases=(()=>{
  let scene="",base=null,stable="",count=0,pending="",matches=0,grace=0,paidFrom=null,at=0;
  let manual={},missingSince=0;
  function reset(){scene="";base=null;stable=pending="";matches=count=grace=0;paidFrom=null;manual={};at=missingSince=0;}
  function credited(name){if(scene)manual[name]=(manual[name]||0)+1;}
  function observe(f){
    if(!f.cells || !f.layout){reset();return [];}
    const roundVisible=Number.isInteger(f.round);
    const key=(roundVisible?f.round:db.run.round)+"/"+(f.terminal??db.run.terminal)+"/"+f.layout,now=Date.now();
    if(scene!==key || now-at>6500){reset();scene=key;}at=now;
    const cards={};
    for(const [slot,labels] of Object.entries(f.cells)){
      const names=[...new Set(labels.map(row=>row.find(n=>catalogue["op:"+n] || catalogue["eq:"+n])).filter(Boolean))];
      if(names.length>1){reset();return [];}
      if(names.length)cards[slot]=names[0];
    }
    const signature=JSON.stringify(cards),money=f.money,known=Number.isInteger(money);
    const replacement=base && Object.entries(cards).some(([slot,name])=>base.cards[slot]!==name);
    if(replacement){reset();scene=key;at=now;}
    const missing=base?Object.keys(base.cards).filter(slot=>!(slot in cards)):[];
    if(missing.length){
      if(!missingSince)missingSince=now;
      if(now-missingSince>6000){reset();return [];}
      const paid=(paidFrom??base.money)>money && known;
      const empty=(roundVisible || Object.keys(cards).length>0) && missing.every(slot=>f.empty?.includes(Number(slot)));
      if(!empty || !paid){pending="";matches=0;return [];}
      const mark=signature+"/"+money;
      matches=mark===pending?matches+1:1;pending=mark;
      if(matches<2)return [];
      const bought=[];
      for(const slot of missing){
        const name=base.cards[slot];
        if(manual[name])manual[name]--;
        else if(catalogue["op:"+name])bought.push(name);
      }
      base={cards,money};stable=signature;count=2;pending="";matches=grace=missingSince=0;paidFrom=null;
      return bought;
    }
    pending="";matches=missingSince=0;count=signature===stable?count+1:1;stable=signature;
    if(base && known && money<base.money){paidFrom=base.money;grace=2;}
    else if(grace && --grace===0)paidFrom=null;
    if(count>=2 && known)base={cards,money};
    return [];
  }
  return {observe,reset,credited};
})();
