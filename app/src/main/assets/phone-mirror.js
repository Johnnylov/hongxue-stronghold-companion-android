"use strict";
const PhoneMirror=(()=>{
  const trigger=$("phone-connect"), panel=$("phone-panel");
  let running=false,folded=false,device="",pin="",message="",previous={},shop=[],advice="",request=0;
  let lastFrame=0,pendingKey="",seen=false;
  let confirmed={};
  let painted="";
  function show(html){if(html!==painted){panel.innerHTML=html;painted=html;}}
  function paint(){
    panel.classList.toggle("folded",folded);
    if(folded){show('<button class="btn light" data-m="expand">iPhone · '+esc(seen?"本局建议":"投屏连接")+'</button>');return;}
    const head='<div class="mirror-head"><b>iPhone 对局助手</b><button class="linkbtn" data-m="fold">收起</button></div>';
    const help=device?'iPhone 控制中心 → 屏幕镜像 → '+device:'两台设备连接同一 Wi-Fi，在平板前台接收。';
    show(head+'<p>'+esc(message || help)+'</p>'+
      (running && device && !seen?'<p>'+esc(help)+'</p>':'')+
      (pin?'<p><b>配对码 '+esc(pin)+'</b></p>':'')+
      (seen?'<p>第 '+db.run.round+' 回合'+(confirmed.round===db.run.round?'':'（记录）')+' · '+db.run.terminal+' 本'+(confirmed.terminal===db.run.terminal?'':'（记录）')+' · '+(db.run.money==null?'余额待确认':'余额 '+db.run.money+(confirmed.money===db.run.money?'':'（记录）'))+(db.run.terminal<6 && confirmed.upgrade!=null?' · 升本需 '+confirmed.upgrade:'')+'</p><p><b>'+esc(advice || "正在按当前阵容计算")+'</b></p>':'')+
      '<div class="mirror-shop">'+shop.map(n=>catalogue["op:"+n]?'<button class="btn light" data-unit-buy="'+esc(n)+'">拿了'+esc(n)+' ＋1</button>':'<span>'+esc(n)+'</span>').join("")+'</div>'+
      '<button class="linkbtn" data-m="'+(running?'stop':'start')+'">'+(running?'断开 iPhone':'开始接收')+'</button>');
  }
  async function recommend(){
    const req=Planning.payload("auto"), key=JSON.stringify([req,shop]);
    if(key===pendingKey)return;pendingKey=key;
    const token=++request;
    try{
      const team=active(), preferred=team?.autoPlan?.candidate?.mainCovenant;
      const result=await Planning.matchRoute(req,preferred);
      if(token!==request)return;
      const entry=Planning.routeEntry(result.route,result.advice,req.terminal,req.round===GuideModel.maxRound);
      const targets=entry?.level?.keyCards || [];
      const candidates=[...targets,...(entry?.stage.operators || []).filter(o=>!db.run.counts[o.name]).map(o=>o.name)];
      const pick=candidates.find(n=>shop.includes(n) && !Workbench.isBanned(n) && Planning.recruitment(n,req.terminal).canRoll===true &&
        (req.money==null || PlanMatch.price(n)<=req.money));
      advice=pick && req.upgrade!==0?'本轮商店优先拿'+pick:NextStep.routeAction(entry) || "核对当前阵容与商店";
      if(shop.length && !pick && advice.startsWith("本轮遇到时先拿"))advice="已识别商品里暂未见优先人选，先留钱。"+advice;
    }catch{if(token!==request)return;advice="当前阵容暂无路线，可在规划页调整";}
    paint();
  }
  function frame(data){
    lastFrame=Date.now();
    const agree=k=>data[k]!==undefined && data[k]===previous[k];
    const valid=(n,min,max)=>Number.isInteger(n) && n>=min && n<=max;
    let changed=false;
    const r=db.run;
    if(valid(data.round,1,15) && data.round!==r.round && !agree("round")){
      previous=data;shop=[];seen=false;message="正在确认新回合";paint();return;
    }
    if(agree("round") && valid(data.round,1,15) && data.round!==r.round){
      r.round=data.round;confirmed={};Economy.changed(r,"round");if(db.prefs.autoStage)Teams.roundChanged();changed=true;
    }
    if(agree("terminal") && valid(data.terminal,1,6) && r.terminal!==data.terminal){
      r.terminal=data.terminal;Economy.changed(r,"terminal");changed=true;
    }
    if(agree("money") && valid(data.money,0,20) && r.money!==data.money){ItemIncome.confirmBalance(r,data.money);changed=true;}
    if(agree("upgrade") && valid(data.upgrade,0,40) && r.terminal<6 && r.upgrade!==data.upgrade){r.upgrade=data.upgrade;changed=true;}
    for(const k of ["round","terminal","money","upgrade"])if(agree(k))confirmed[k]=data[k];
    const names=raw=>(Array.isArray(raw)?raw:[]).map(item=>(Array.isArray(item)?item:[item])
      .find(n=>catalogue["op:"+n] || catalogue["eq:"+n])).filter(Boolean);
    const oldShop=names(previous.shop);
    shop=[...new Set(names(data.shop).filter(n=>oldShop.includes(n)))];
    seen=agree("round") || agree("money") || agree("terminal") || shop.length>0;
    previous=data;pin="";message=seen?"已同步游戏画面":"已收到画面，等待可读的回合或商店";
    if(changed){persist();render();}
    if(seen)recommend();
    paint();
  }
  function reset(){previous={};confirmed={};shop=[];seen=false;lastFrame=0;pin="";advice="";pendingKey="";request++;}
  function event(type,value){
    if(type==="off" || type==="error"){reset();running=false;device="";message=value;}
    else if(!running)return;
    else if(type==="name"){device=value;message="等待 iPhone 投屏";}
    else if(type==="pin"){pin=value;message="在 iPhone 上输入配对码";folded=false;}
    else if(type==="frame"){frame(value);return;}
    else if(type==="stream"){reset();message=value==="true"?"已连接，等待画面":"已断开，等待重新投屏";}
    else if(type==="status"){message=value;}
    paint();
  }
  trigger.hidden=typeof window.Tablet?.phoneMirror!=="function";
  trigger.onclick=()=>{panel.hidden=false;folded=false;paint();};
  panel.onclick=e=>{
    const b=e.target.closest("button");if(!b)return;
    const n=b.dataset.unitBuy;
    if(n && shop.includes(n)){
      const unit={name:n,count:db.run.counts[n] || 0,elite:db.run.elite[n] || 0};
      QuickRoster.setNumber(unit,"buy",1);db.run.counts[n]=unit.count;db.run.elite[n]=unit.elite;
      Maps.ownedChanged();persist();render();toast("已记录购入"+n);recommend();return;
    }
    switch(b.dataset.m){
      case "start":reset();running=true;message="正在启动局域网接收";Tablet.phoneMirror(true);break;
      case "stop":Tablet.phoneMirror(false);break;
      case "fold":if(!running){panel.hidden=true;return;}folded=true;break;
      case "expand":folded=false;break;
    }paint();
  };
  setInterval(()=>{if(running && lastFrame && Date.now()-lastFrame>7000){
    reset();message="暂未收到新画面，等待 iPhone 恢复投屏";paint();
  }},2000);
  return {event};
})();
window.PhoneMirror=PhoneMirror;
