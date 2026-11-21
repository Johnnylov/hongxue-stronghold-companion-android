"use strict";
const PhoneMirror=(()=>{
  const trigger=$("phone-connect"), panel=$("phone-panel");
  let running=false,folded=false,device="",pin="",message="",previous={},shop=[],advice="",request=0;
  let lastFrame=0,pendingKey="",seen=false;
  let confirmed={};
  let lastPacket=0;
  let painted="";
  let returnPage=null;
  function overlayView(view){
    const body=document.body;
    if(!local)return;
    const wasBoard=body.classList.contains("overlay-board");
    if(wasBoard!==(view==="board") || body.classList.contains("overlay-library")!==(view==="guide"))close();
    body.classList.toggle("overlay-library",view==="guide");
    body.classList.toggle("overlay-board",view==="board");
    if(view==="board" && !wasBoard){
      returnPage={page:db.page,detail:db.detail};
      if(db.page==="map"){render();window.scrollTo(0,0);}else move("map");
      Maps.showInitial();
    }else if(wasBoard && view!=="board"){
      if(returnPage?.page==="map"){render();window.scrollTo(0,0);}
      else if(returnPage)move(returnPage.page,returnPage.detail);
      returnPage=null;
    }
  }
  let local=false,receipt="";
  function show(html){if(html!==painted){panel.innerHTML=html;painted=html;}}
  function metric(label,value,recorded){
    return '<div><dt>'+label+'</dt> <dd>'+esc(value)+(recorded?'<small>记录</small>':'')+'</dd></div>';
  }
  function paint(){
    panel.classList.toggle("folded",folded);
    if(folded){show('<button class="btn light" data-m="expand">iPhone · '+esc(seen?"本局建议":"投屏连接")+'</button>');return;}
    const head=local?'':'<div class="mirror-head"><b>游戏连接</b><button class="linkbtn" data-m="fold">收起</button></div>';
    const help=device?'iPhone 控制中心 → 屏幕镜像 → '+device:'在平板本机玩，或连接同一 Wi-Fi 下的 iPhone。';
    const run=db.run;
    const stats=seen?'<dl class="match-metrics">'+metric("回合",run.round+" / 15",confirmed.round!==run.round)+metric("终端",run.terminal+" 本",confirmed.terminal!==run.terminal)+
      metric("余额",run.money??"待确认",run.money!=null && confirmed.money!==run.money)+(run.terminal<6 && confirmed.upgrade!=null?metric("升本需",confirmed.upgrade,false):"")+'</dl>':'';
    show(head+'<p class="mirror-status">'+esc(message || help)+'</p>'+
      (running && device && !seen && !lastFrame && !lastPacket?'<p>'+esc(help)+'</p>':'')+
      (pin?'<p><b>配对码 '+esc(pin)+'</b></p>':'')+(receipt?'<p>'+esc(receipt)+'</p>':'')+
      stats+(seen?'<p class="mirror-decision"><b>'+esc(advice || "正在按当前阵容计算")+'</b></p>':'')+
      '<div class="mirror-shop">'+shop.map(n=>catalogue["op:"+n]?'<button class="btn light" data-unit-buy="'+esc(n)+'">拿了'+esc(n)+' ＋1</button>':'<span>'+esc(n)+'</span>').join("")+'</div>'+
      (local?'':'<div class="mirror-actions">'+(running?'':'<button class="btn" data-m="local">本机游戏悬浮窗</button>')+
      '<button class="btn light" data-m="'+(running?'stop':'start')+'">'+(running?'断开 iPhone':'接收 iPhone 投屏')+'</button></div>'));
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
  function parseInfo(raw){
    if(!raw)return null;
    const clean=s=>s.replace(/[^\u3400-\u9fff0-9]/g,"");
    const text=clean(raw.enemies.join("")), types=Object.entries(Workbench.data.enemy_types.types)
      .filter(([,v])=>text.includes("特训敌人"+v.typeName) || text.includes("特训致人"+v.typeName)).map(([id])=>id).sort();
    const bosses=Workbench.data.bosses.bosses, boss=bosses.find(b=>text.includes(clean(b.name)))?.name;
    const mode= bosses[0].hp.find(m=>raw.modes.some(t=>clean(t)===clean(m.name)))?.mode;
    const names=new Set(Workbench.data.covenants.covenants.map(b=>b.name)), states={};
    for(const icon of raw.icons){
      const name=clean(icon.text).replace("伊利亚","伊比利亚");
      if(names.has(name))states[name]=icon.banned;
    }
    // Colour evidence from this screen is required before interpreting grey as banned.
    if(!Object.values(states).includes(false))return {boss,types,mode,states:{}};
    return {boss,types,mode,states};
  }
  function infoFrame(raw){
    const info=parseInfo(raw), old=previous.match, r=db.run;
    previous={match:info};seen=false;shop=[];advice="";pendingKey="";request++;
    if(!old){message="正在核对本局信息";paint();return;}
    let changed=false,bansChanged=false;
    const parts=[];
    if(info.mode && info.mode===old.mode){
      if(r.mode!==info.mode){r.mode=info.mode;Economy.changed(r,"mode");changed=bansChanged=true;}
      parts.push(Workbench.data.bosses.bosses[0].hp.find(m=>m.mode===info.mode).name);
    }
    if(info.boss && info.boss===old.boss){if(r.boss!==info.boss){r.boss=info.boss;changed=true;}parts.push(info.boss);}
    const types=info.types.filter(t=>old.types.includes(t));
    if(types.length){
      const next=types.length===3?types:[...new Set([...r.enemyTypes,...types])].sort();
      if(next.join()!==[...r.enemyTypes].sort().join()){r.enemyTypes=next;changed=true;}
      parts.push("特训："+types.map(k=>Workbench.data.enemy_types.types[k].typeName).join("、"));
    }
    const stable=Object.entries(info.states).filter(([name,v])=>old.states[name]===v);
    if(stable.length){
      const bonds=new Set(r.bannedBonds);
      for(const [name,ban] of stable){if(ban)bonds.add(name);else bonds.delete(name);}
      if(bonds.size!==r.bannedBonds.length || r.bannedBonds.some(n=>!bonds.has(n))){
        r.bannedBonds=[...bonds];changed=bansChanged=true;
      }
      parts.push("已核对 "+stable.length+" 个盟约，禁用 "+stable.filter(([,v])=>v).length+" 个");
    }
    if(bansChanged)Maps.bansChanged();
    if(changed){persist();render();}
    message=parts.length?"本局信息 · "+parts.join(" · "):"已看到本局信息，等待读清文字和图标";paint();
  }
  function frame(data){
    lastFrame=Date.now();
    const bought=Purchases.observe(data);
    if(bought.length){
      for(const name of bought)addOwned(name);
      receipt="自动入池："+bought.join("、");
      Maps.ownedChanged();persist();render();
    }
    if(data.info){infoFrame(data.info);return;}
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
  function addOwned(name){
    const unit={name,count:db.run.counts[name] || 0,elite:db.run.elite[name] || 0};
    QuickRoster.setNumber(unit,"buy",1);db.run.counts[name]=unit.count;db.run.elite[name]=unit.elite;
  }
  function reset(){Purchases.reset();previous={};confirmed={};shop=[];seen=false;lastPacket=lastFrame=0;pin="";receipt=advice="";pendingKey="";request++;}
  function event(type,value){
    if(type==="local"){reset();local=running=true;folded=false;panel.hidden=false;document.body.classList.add("local-game");message="等待平板游戏画面";}
    else if(type==="off" || type==="error"){overlayView("advice");reset();local=running=false;device="";message=value;document.body.classList.remove("local-game","overlay-library","overlay-board");}
    else if(!running)return;
    else if(type==="name"){device=value;message="等待 iPhone 投屏";}
    else if(type==="pin"){pin=value;message="在 iPhone 上输入配对码";folded=false;}
    else if(type==="frame"){frame(value);return;}
    else if(type==="packet"){lastPacket=Date.now();return;}
    else if(type==="reset"){reset();message="投屏连接已中断（接收器代码 "+value+"）。请在 iPhone 屏幕镜像重新选择 "+device;}
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
      Purchases.credited(n);addOwned(n);
      Maps.ownedChanged();persist();render();toast("已记录购入"+n);recommend();return;
    }
    switch(b.dataset.m){
      case "local":message="请允许悬浮窗和屏幕共享，再打开游戏";Tablet.localGame();break;
      case "start":reset();running=true;message="正在启动局域网接收";Tablet.phoneMirror(true);break;
      case "stop":Tablet.phoneMirror(false);break;
      case "fold":if(!running){panel.hidden=true;return;}folded=true;break;
      case "expand":folded=false;break;
    }paint();
  };
  setInterval(()=>{if(running && Math.max(lastFrame,lastPacket) && Date.now()-Math.max(lastFrame,lastPacket)>12000){
    reset();message=local?"等待平板游戏更新画面":"暂未收到新画面；接收器仍在监听 "+device;paint();
  }},2000);
  return {event,overlayView};
})();
window.PhoneMirror=PhoneMirror;
