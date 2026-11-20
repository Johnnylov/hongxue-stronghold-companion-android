"use strict";
const Maps = (() => {
  const W = Workbench;
  let selected = "",
    inspecting = false,
    job = 0,
    busy = false,
    runningKey = "",
    status = "";
  const faces = ["→", "↓", "←", "↑"],
    types = {
      G: "地面",
      T: "特殊地块",
      H: "高台",
      X: "不可部署",
      D: "防守点",
      S: "出怪点",
    };
  function workshopStage() {
    const ref=db.workshopMap;
    return db.page==="map" && ref && db.teams.find(t=>t.id===ref.teamId)?.stages[ref.index];
  }
  function openWorkshop(t) {
    const index=stageNum(t), stage=t.stages[index];
    const pool=QuickRoster.fromStage({entries:stage.entries.filter(e=>!e.reserve)})
      .filter(p=>W.profiles[p.name]?.normalRange?.base && !W.isBanned(p.name));
    if (!pool.length) {toast("本阶段没有可部署干员");return;}
    const board=(stage.workshopBoard ||= {map:db.board?.map || W.data.garrison_maps.maps[0].id,
      mode:1,people:db.planning.people || 8,source:"trial",tab:"board",routes:true,pool:[],layouts:{}});
    cancelCalculation(false);
    const changed=JSON.stringify(board.pool)!==JSON.stringify(pool);
    board.pool=pool;
    db.workshopMap={teamId:t.id,index};
    selected=""; inspecting=false;
    move("map");
    if(changed) {prune();board.needsSolve=true;persist();render();}
    showInitial();
  }
  function leaveWorkshop() {
    cancelCalculation(false);
    db.workshopMap=null; selected=""; inspecting=false;
  }
  function base() {
    if(workshopStage()) return workshopStage().workshopBoard;
    const m = (db.board ||= {
      map: W.data.garrison_maps.maps[0].id,
      people: 8,
      mode: 1,
      pool: [],
      layouts: {},
      routes: true,
    });
    if (!m.source) {
      const held = QuickRoster.owned();
      const same = m.pool.length === held.length && m.pool.every(p => held.some(u =>
        u.name === p.name && p.count === u.count && p.elite === u.elite));
      m.source = !m.pool.length || same ? "owned" : "trial";
      if (!m.pool.length) m.pool = held;
    }
    if (m.tab === "owned") m.tab = "board";
    return m;
  }
  function sheet() {
    const m = base();
    return (m.layouts[m.map] ||= {
      placed: {},
      pins: [],
      checks: [],
      active: [],
      total: null,
    });
  }
  function current() {
    return W.data.garrison_maps.maps.find((x) => x.id === base().map);
  }
  function candidates(pool = base().pool) {
    return pool.filter(p => !W.isBanned(p.name)).flatMap((p) =>
      Array.from({ length: p.count }, (_, i) => ({
        name: p.name,
        isElite: i < p.elite,
        copy: i,
        key: i ? p.name + "#" + (i + 1) : p.name,
      })),
    );
  }
  function getName(k) {
    return candidates().find((p) => p.key === k)?.name || k;
  }
  function typeAt(c, r) {
    return current().cells[r]?.[c - W.data.garrison_maps.columns[0]];
  }
  function legal(key, c, r) {
    const t = typeAt(c, r);
    return (
      t === "G" ||
      t === "T" ||
      (t === "H" && W.profiles[getName(key)]?.position !== "近战")
    );
  }
  function prune() {
    const keys = new Set(candidates().map((p) => p.key));
    for (const sh of Object.values(base().layouts)) {
      for (const k of Object.keys(sh.placed))
        if (!keys.has(k)) delete sh.placed[k];
      sh.pins = sh.pins.filter((k) => keys.has(k));
      sh.total = null;
      sh.checks = [];
      sh.active = [];
    }
    if (!keys.has(selected)) selected = "";
  }
  function ownedChanged() {
    if (!db.board) return;
    const m = base();
    if (m.source !== "owned") return;
    const held = QuickRoster.owned();
    if (JSON.stringify(held) === JSON.stringify(m.pool)) return;
    cancelCalculation(false);
    m.pool = held;
    m.needsSolve = true;
    prune();
  }
  function sync(solve = true) {
    const m = base();
    cancelCalculation(false);
    prune();
    m.needsSolve = true;
    if (m.source === "owned") QuickRoster.setOwned(m.pool);
    persist();
    if (solve && m.pool.length) void calculate("placement");
    else render();
    renderBasket();
  }
  function showInitial() {
    if (!busy && base().pool.length && !Object.keys(sheet().placed).length && !sheet().manual)
      void calculate("placement");
  }
  function bansChanged() {
    if (!db.board) return;
    cancelCalculation(false);
    prune();
    base().needsSolve = true;
  }
  function restoreRosterSource() {
    if (!db.modeBansMigrated) {
      if (db.board && W.data.multiplayer_bans[db.run.mode]?.inactive.length) bansChanged();
      db.modeBansMigrated=true;
      persist();
    }
    if (!db.promotionRulesMigrated) {
      for (const name of Object.keys(db.run.counts)) QuickRoster.normalizeOwned(name);
      if (db.board) {
        const before = JSON.stringify(db.board.pool);
        db.board.pool.forEach(QuickRoster.normalize);
        const changed = before !== JSON.stringify(db.board.pool);
        base();
        if (changed || db.run.banned.length || db.run.bannedBonds.length) bansChanged();
      }
      db.promotionRulesMigrated = true;
      persist();
    } else if (db.board && (!db.board.source || db.board.tab === "owned")) {
      base();
      persist();
    }
  }
  function savedField(req) {
    const last = db.board?.layouts?.[req.map]?.recommended;
    return last?.key === JSON.stringify(["placement-v1.9.4-1","placement",{...req,pins:{}}])
      ? Object.keys(last.placed) : null;
  }
  function waitingForRoster() {
    return db.page === "map" && db.board?.source === "owned" && (busy || (inspecting && db.board.needsSolve));
  }
  function moveTo(key, col, row) {
    const sh = sheet(),
      m = base();
    if (!legal(key, col, row)) {
      toast("这个干员无法部署在该地块");
      return;
    }
    const old = sh.placed[key],
      occupant = Object.keys(sh.placed).find(
        (k) => sh.placed[k].cell.col === col && sh.placed[k].cell.row === row,
      );
    if (occupant === key) return;
    if (occupant && sh.pins.includes(occupant)) {
      toast("请先解除该位置的固定");
      return;
    }
    if (!old && !occupant && Object.keys(sh.placed).length >= m.people) {
      toast("已达上场人数，请先让一名干员下场");
      return;
    }
    if (occupant && old && !legal(occupant, old.cell.col, old.cell.row)) {
      toast("交换后的地块不适合另一名干员");
      return;
    }
    if (occupant) {
      if (old) sh.placed[occupant] = { ...sh.placed[occupant], cell: old.cell };
      else delete sh.placed[occupant];
    }
    sh.placed[key] = { ...old, cell: { col, row }, facing: old?.facing || 0 };
    invalidate();
  }
  function deployOne(p) {
    const sh=sheet(), map=current(), m=base();
    if (sh.placed[p.key]) {
      selected=""; inspecting=false; delete sh.placed[p.key];
      sh.pins=sh.pins.filter(key=>key!==p.key);
      sh.manual=true; invalidate(); return;
    }
    if (Object.keys(sh.placed).length>=m.people) { toast("上场已满，先点场上一名干员的 ✓ 下场"); return; }
    const taken=new Set(Object.values(sh.placed).map(v=>v.cell.col+","+v.cell.row));
    const available=(c,r)=>!taken.has(c+","+r) && legal(p.key,c,r);
    const previous=sh.recommended?.placed[p.key]?.cell;
    let cell=previous && available(previous.col,previous.row) ? previous : null;
    if (!cell) {
      const tiles=[], left=W.data.garrison_maps.columns[0];
      const lanes=map.routes.flatMap(route=>route.cells);
      const melee=W.profiles[p.name]?.position==="近战";
      map.cells.forEach((line,row)=>Array.from(line).forEach((type,i)=>{
        const col=left+i;
        if (!available(col,row)) return;
        const distance=Math.min(...lanes.map(([x,y])=>Math.abs(col-x)+Math.abs(row-y)));
        tiles.push({col,row,cost:distance + (!melee && type!=="H" ? 2 : 0)});
      }));
      tiles.sort((a,b)=>a.cost-b.cost || a.col-b.col || a.row-b.row);
      cell=tiles[0];
    }
    if (!cell) {toast("没有可用地块");return;}
    selected=""; inspecting=false; moveTo(p.key,cell.col,cell.row);
  }
  function editCard(action,key) {
    const m=base(), pool=candidates(), card=pool.find(p=>p.key===key);
    if(!card) return;
    if(action==="field") {deployOne(card);return;}
    if(workshopStage()) return;
    const unit=m.pool.find(u=>u.name===card.name);
    if(!unit) return;
    const rows=pool.filter(p=>p.name===unit.name);
    const oldKeys=new Set(rows.map(p=>p.key));
    const size=QuickRoster.mergeSize(unit.name);
    const ordinary=rows.filter(p=>!p.isElite);
    if(action==="copy") {
      if(ordinary.length===size-1) {
        const sh=sheet();
        const priority=p=>Number(sh.pins.includes(p.key))*4+Number(!!sh.placed[p.key])*2+Number(p.key===key);
        ordinary.sort((a,b)=>priority(b)-priority(a));
        ordinary[0].isElite=true;
        for(const consumed of ordinary.slice(1)) rows.splice(rows.indexOf(consumed),1);
      } else rows.push({name:card.name,isElite:false});
    } else if(action==="remove") rows.splice(rows.indexOf(card),1);
    else if(action==="elite") {
      if(card.isElite && ordinary.length>=size-1) {toast("普通份数已达合成阈值");return;}
      card.isElite=!card.isElite;
    } else return;
    // Map copy keys put elites first. Keep each surviving piece's cell, facing and pin when its number changes.
    rows.sort((a,b)=>Number(b.isElite)-Number(a.isElite));
    const renamed=new Map();
    rows.forEach((p,i)=>{if(p.key) renamed.set(p.key,i?card.name+"#"+(i+1):card.name);});
    for(const layout of Object.values(m.layouts)) {
      const placed={};
      for (const [k,value] of Object.entries(layout.placed)) {
        const next=oldKeys.has(k)?renamed.get(k):k;
        if(next) placed[next]=value;
      }
      layout.placed=placed;
      layout.pins=layout.pins.map(k=>oldKeys.has(k)?renamed.get(k):k).filter(Boolean);
      layout.recommended=null;
    }
    unit.count=rows.length; unit.elite=rows.filter(p=>p.isElite).length;
    if (!unit.count) m.pool=m.pool.filter(u=>u!==unit);
    if(oldKeys.has(selected)) selected=renamed.get(selected) || "";
    inspecting=false;
    sync(false);
  }
  function invalidate() {
    sheet().total = null;
    sheet().checks = [];
    sheet().active = [];
    persist();
    render();
    if (Object.keys(sheet().placed).length) void calculate("evaluate");
    else cancelCalculation();
  }
  function cancelCalculation(repaint = true) {
    if (!busy) return;
    ++job;
    busy = false;
    runningKey = "";
    W.stopMap();
    if (repaint && db.page === "map") render();
  }
  function positions(keys, placed) {
    return Object.fromEntries(keys.filter(k => placed[k]).map(k => {
      const { cell, facing } = placed[k];
      return [k, { cell, facing }];
    }));
  }
  async function calculate(action) {
    const m = base(),
      sh = sheet(),
      pool = candidates();
    if (!pool.length) {
      toast("先加入干员，再推荐站位");
      return;
    }
    const req = { map: m.map, pool, people: m.people, mode: m.mode, pins: positions(sh.pins, sh.placed) };
    if (action === "evaluate") req.cells = positions(Object.keys(sh.placed), sh.placed);
    const key = JSON.stringify(["placement-v1.9.4-1", action, req]);
    if (busy && runningKey === key) return;
    cancelCalculation(false);
    if (action === "placement" && sh.recommended?.key === key) {
      const { placed, total, active, checks } = sh.recommended;
      m.needsSolve = false;
      Object.assign(sh, { placed: clone(placed), total, active, checks, manual: false });
      persist();
      render();
      return;
    }
    const ticket = ++job;
    busy = true;
    runningKey = key;
    status = action === "placement" ? "准备计算…" : "正在评估…";
    render();
    try {
      const result = await W.engine(action, req, (step, total) => {
        if (ticket !== job) return;
        status = `搜索站位 ${step}/${total}`;
        const label = desk.querySelector('[data-w="map-solve"]');
        if (label) label.textContent = status;
      });
      if (ticket !== job) return;
      sh.placed = Object.fromEntries(
        result.placed.map((p) => [
          p.key,
          { cell: p.cell, facing: p.facing, notes: p.notes, role: p.role },
        ]),
      );
      sh.total = result.total;
      if (action === "placement") {
        m.needsSolve = false;
        sh.recommended = { key, placed: clone(sh.placed), total: result.total,
          active: result.activeCovenants, checks: result.checks };
        sh.manual = false;
      } else {
        sh.manual = true;
      }
      sh.active = result.activeCovenants;
      sh.checks = result.checks;
      persist();
    } catch (e) {
      if (ticket === job) toast("无法计算站位：" + e.message);
    } finally {
      if (ticket === job) {
        busy = false;
        runningKey = "";
        if (db.page === "map") render();
        if (db.prefs.basketTab === "recommend") renderBasket();
      }
    }
  }
  function visibleBounds(map) {
    const all = map.cells[0].length;
    let rows = map.cells.length,
      left = 0,
      right = all - 1;
    while (rows > 1 && /^X+$/.test(map.cells[rows - 1])) rows--;
    const emptyColumn = (col) =>
      map.cells.slice(0, rows).every((row) => row[col] === "X");
    while (left < right && emptyColumn(left)) left++;
    while (right > left && emptyColumn(right)) right--;
    return { rows, left, right };
  }
  function routeLayer(map, minColumn, filter) {
    const cellSize = 100;
    const lines = map.routes
      .map((route, index) => {
        if (filter !== "both" && filter !== String(index)) return "";
        const offset = index === 0 ? -0.15 : 0.16;
        const pts = route.cells.map(([c, r]) => [
          (c - minColumn + 0.5 + offset) * cellSize,
          (r + 0.5 + offset) * cellSize,
        ]);
        const path = pts.map((p) => p.join(",")).join(" ");
        const arrows = pts
          .slice(1)
          .map(([x, y], i) => {
            const [prevX, prevY] = pts[i],
              dx = x - prevX,
              dy = y - prevY,
              angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return `<g transform="translate(${prevX + dx * 0.56},${prevY + dy * 0.56}) rotate(${angle})"><path class="way-arrow" d="M -6,-8 L 5,0 L -6,8"/></g>`;
          })
          .join("");
        const [x, y] = pts[0],
          [endX, endY] = pts[pts.length - 1];
        return `<g class="enemy-path enemy-path-${index}" data-route-index="${index}"><title>${index === 0 ? "上路" : "下路"}敌方行进方向</title><polyline class="way-halo" points="${path}"/><polyline class="way-line" points="${path}"/>${arrows}<circle class="way-start" cx="${x}" cy="${y}" r="6"/><circle class="way-end" cx="${endX}" cy="${endY}" r="5"/></g>`;
      })
      .join("");
    const bounds = visibleBounds(map);
    return `<svg class="enemy-routes" aria-label="从出怪点到防守点的敌方路线" viewBox="${bounds.left * cellSize} 0 ${(bounds.right - bounds.left + 1) * cellSize} ${bounds.rows * cellSize}" preserveAspectRatio="none">${lines}</svg>`;
  }
  function render() {
    const m = base(),
      sh = sheet(),
      map = current(),
      pool = candidates(),
      byKey = new Map(pool.map(p => [p.key, p])),
      min = W.data.garrison_maps.columns[0];
    const selectedPiece = sh.placed[selected];
    const roles = ["输出", "承伤", "辅助", "叠层"];
    const sub = m.tab || "board";
    const tabs = workshopStage() ? W.act("map-workshop-back","‹ 返回阵容推演 · "+workshopStage().label,"btn light") : `<div class="tracking-tabs">${[
      ["shop", "购买清单"],
      ["recommend", "推荐阵容"],
      ["board", "干员与地图"],
    ]
      .map(([id, name]) =>
        W.act("map-tab", name, sub === id ? "chosen" : "", id),
      )
      .join("")}</div>`;
    if (sub !== "board") {
      if (sub === "recommend") {
        desk.innerHTML = tabs + RunLineups.view();
      } else {
        const t = active(),
          items = Teams.basketRows();
        desk.innerHTML =
          tabs +
          section(
            t ? t.title : "购买清单",
            t
              ? idButton("open-team", "编辑阵容", t.id, "btn light")
              : button("new", "新建阵容"),
          ) +
          (items.length
            ? `<div class="listbox tracking-cart">${items.map((e) => `<label class="buyrow ${Teams.owned(e.token) ? "done" : ""}"><input type="checkbox" data-buy="${esc(e.token)}" ${Teams.owned(e.token) ? "checked" : ""}>${portrait(e.key)}${facts(e)}</label>`).join("")}</div>`
            : empty(
                "暂无购买需求",
                "先从攻略复制阵容，或在图鉴里加入要购买的干员。",
              ));
      }
      return;
    }
    const bounds = visibleBounds(map),
      coords = new Map(
        Object.entries(sh.placed).map(([k, p]) => [
          p.cell.col + "," + p.cell.row,
          k,
        ]),
      );
    const dots = new Set(),
      selectedCandidate = byKey.get(selected),
      profile = selectedCandidate && W.profiles[selectedCandidate.name];
    if (selectedPiece && profile) {
      const range =
        (selectedCandidate.isElite ? profile.eliteRange : null) ||
        profile.normalRange;
      const allRanges =
        W.data[
          W.rawOps[selectedCandidate.name]?.isCustom
            ? "custom_operator_profiles"
            : "operator_profiles"
        ].ranges;
      for (const [f, s] of allRanges[range?.base] || []) {
        const [dx, dy] = [
          [f, s],
          [-s, f],
          [-f, -s],
          [s, -f],
        ][selectedPiece.facing];
        dots.add(
          selectedPiece.cell.col + dx + "," + (selectedPiece.cell.row + dy),
        );
      }
    }
    const grid = map.cells
      .slice(0, bounds.rows)
      .map((line, row) =>
        Array.from(line.slice(bounds.left, bounds.right + 1), (type, i) => {
          const col = i + bounds.left,
            code = col + min + "," + row,
            k = coords.get(code),
            piece = sh.placed[k],
            label = String.fromCharCode(65 + row) + (col + 1);
          const tileClass = [
            "tile",
            "tile-" + type,
            dots.has(code) ? "in-range" : "",
            k === selected && k ? "selected" : "",
            piece ? "occupied role-" + (piece.role ?? "bench") : "",
          ].join(" ");
          return `<button class="${tileClass}" data-w="map-cell" data-v="${code}" aria-label="${esc(label + " " + types[type] + (k ? " " + k : ""))}" ${k ? `data-piece="${esc(k)}" draggable="true"` : ""}>${k ? `<span class="piece">${portrait("op:" + (byKey.get(k)?.name || k))}${byKey.get(k)?.isElite ? '<i class="tile-elite" aria-label="精锐">精</i>' : ""}<b>${sh.pins.includes(k) ? "•" : ""}${faces[piece.facing]}</b><span class="tile-name">${esc(k)}</span></span>` : ""}</button>`;
        }).join(""),
      )
      .join("");
    const flags = sh.checks
      .map(
        (c) =>
          `<span class="plan-check ${c.isHint ? "hint-check" : c.ok ? "pass" : "fail"}"><b>${c.isHint ? "i" : c.ok ? "✓" : "✗"}</b>${esc(c.text)}</span>`,
      )
      .join("");
    const field = Object.keys(sh.placed)
        .map(k => byKey.get(k))
        .filter(Boolean),
      bench = pool.filter((p) => !sh.placed[p.key]),
      count = field.length;
    function card(p) {
      const piece = sh.placed[p.key],
        role = piece?.role;
      return `<div class="map-unit-card"><button class="deploy-card role-${role ?? "bench"} ${selected === p.key ? "active-unit" : ""}" draggable="true" data-piece="${esc(p.key)}" data-w="map-piece" data-v="${esc(p.key)}">${portrait("op:" + p.name)}<span class="deploy-name"><strong>${esc(p.key)}${p.isElite ? " · 精" : ""}</strong><small>${esc(info("op:" + p.name).tags.join(" · "))}</small></span>${piece && sh.pins.includes(p.key) ? "<i aria-label='已固定'>●</i>" : ""}<span class="role-label">${roles[role] || "备选"}</span></button>${QuickRoster.cardActions("map",p.key,p.key,p.isElite,!!piece,!workshopStage())}</div>`;
    }
    const axisCols = Array.from(
      { length: bounds.right - bounds.left + 1 },
      (_, i) => `<span>${bounds.left + i + 1}</span>`,
    ).join("");
    const axisRows = Array.from(
      { length: bounds.rows },
      (_, i) => `<span>${String.fromCharCode(65 + i)}</span>`,
    ).join("");
    const legend = `<div class="route-options"><label><input type="checkbox" id="map-routes" ${m.routes ? "checked" : ""}> 敌方路线</label>${
      m.routes
        ? `<div class="route-key">${[
            ["both", "两条路线"],
            ["0", "上路"],
            ["1", "下路"],
          ]
            .map(([id, n]) =>
              W.act(
                "map-route-filter",
                n,
                "route-choice route-choice-" +
                  id +
                  ((m.filter || "both") === id ? " on" : ""),
                id,
              ),
            )
            .join("")}</div>`
        : ""
    }</div>`;
    desk.innerHTML = `<div class="deploy-layout">${tabs}
      ${workshopStage() ? "" : `<section class="map-run"><div class="map-run-bar"><button type="button" class="btn light" data-w="map-run-toggle" aria-controls="map-run-panel" aria-expanded="${!!db.prefs.mapRunOpen}">对局设置 ${db.prefs.mapRunOpen ? "▴" : "▾"}</button>
      <span>第 ${db.run.round} 回合 · 终端 ${db.run.terminal} 级${db.run.money == null ? "" : " · 资金 " + esc(db.run.money)}</span>
      ${db.run.round < GuideModel.maxRound ? W.act("map-next-round","下一回合","linkbtn") : ""}</div>
      <div id="map-run-panel" ${db.prefs.mapRunOpen ? "" : "hidden"}>${db.prefs.mapRunOpen ? W.runPanel() : ""}</div></section>
      <div id="map-next-step">${NextStep.view()}</div>`}
      <div class="map-head map-preview-head"><button class="map-photo" type="button" data-w="map-zoom" aria-label="放大${esc(map.name)}"><img alt="${esc(map.name)}全图" src="img/${esc(map.id)}.webp"></button><div><strong>${esc(map.name)}</strong><small>终端 ${db.run.terminal} 级${sh.active?.length ? " · " + esc(sh.active.join(" · ")) : ""}</small><div class="actions">${W.act("map-gallery","看图选地图","btn light")}${W.act("map-zoom","放大","linkbtn")}</div></div><label class="map-picker">切换地图${W.select(
      "map-id",
      W.data.garrison_maps.maps.map((z) => [z.id, z.name]),
      m.map,
    )}</label></div>
      <div class="deploy-modes"><div class="tracking-tabs">${["战斗", "平衡", "叠层"].map((n, i) => W.act("map-mode-set", n, m.mode === i ? "chosen" : "", "" + i)).join("")}</div><div class="tracking-tabs">${[8, 9].map((i) => W.act("map-count-set", i, m.people === i ? "chosen" : "", "" + i)).join("")}</div></div>
      <div class="bench-head roster-bar"><strong>${workshopStage() ? "本阶段上场" : m.source === "owned" ? "本局持有" : "阵容试摆"} · ${m.pool.length} 名</strong><span>共 ${pool.length} 份 · 精锐 ${pool.filter(p=>p.isElite).length} 份</span>${workshopStage() ? "" : W.act("map-pool","快调干员","btn light")}</div>
      <article class="board-panel"><div class="board-shell"><div class="board-cols">${axisCols}</div><div class="board-rows">${axisRows}</div><div class="board">${grid}${m.routes ? routeLayer(map, min, m.filter || "both") : ""}</div></div>
      <div class="plan-checks" aria-label="站位校验" aria-live="polite">${flags || `<span class="hint">${busy ? "正在计算站位校验…" : m.needsSolve ? "持有数量已更新，可继续调整或重新推荐站位。" : count ? "正在评估当前摆位…" : "选择干员并推荐站位后，显示盟约、上下路阻挡与治疗。"}</span>`}</div></article>
      ${selected ? `<div class="selected-piece"><strong>${esc(selected)}${roles[selectedPiece?.role] ? " · " + roles[selectedPiece.role] : ""}</strong>${inspecting && selectedCandidate && !workshopStage() ? QuickRoster.numbers(m.pool.find(p=>p.name === selectedCandidate.name),"map-number") : ""}<div class="actions">${inspecting && selectedPiece ? W.act("map-arm-move","移动 / 换位") : ""}${selectedPiece ? W.act("map-turn", "转向 " + faces[selectedPiece.facing]) + W.act("map-pin", sh.pins.includes(selected) ? "解除固定" : "固定位置") + W.act("map-bench", "下场") : "<small>点一个可用格子部署</small>"}${m.needsSolve ? W.act("map-finish-edit", "完成并推荐站位", "btn gold") : ""}${W.act("map-deselect", "收起", "linkbtn")}</div>${!m.needsSolve && selectedPiece?.notes ? `<p class="hint">${esc(selectedPiece.notes.join(" · "))}</p>` : ""}</div>` : ""}
      ${pool.length ? `<p class="unit-key">${workshopStage()?"✓ 上场 / 下场":"＋1 收入整备区　精 标记精锐　✓ 上场 / 下场　× 删这一份"}</p>`:""}
      ${field.length ? `<div class="deploy-roster">${field.map(card).join("")}</div>` : ""}
      <div class="bench-head"><strong>整备区 · ${bench.length} 人</strong><span>上场 ${count} · 已获取 ${new Set(pool.map((p) => p.name)).size} 名</span>${workshopStage() ? "" : W.act("map-pool", "干员池 ›", "linkbtn")}</div>
      ${bench.length ? `<div class="deploy-roster">${bench.map(card).join("")}</div>` : ""}
      <div class="deploy-tools actions">${W.act("map-solve", busy ? status : m.needsSolve && count ? "更新推荐站位" : "推荐站位", "btn gold")}${busy ? W.act("map-cancel", "取消计算", "linkbtn") : ""}${workshopStage() ? "" : W.act("map-team", "使用当前阵容")+W.act("map-owned", "使用实际拥有池")+W.act("map-counts", "数量与精锐")}${W.act("map-evaluate", "评估当前摆位", "linkbtn")}</div>
      ${legend}${sh.manual && sh.recommended && sh.total !== null ? `<div class="actions"><p class="hint">手动摆位 · 较推荐 ${Math.round((sh.total - sh.recommended.total) * 10) / 10}</p>${W.act("map-restore", "恢复推荐站位", "linkbtn")}</div>` : ""}</div>`;
    const cols = bounds.right - bounds.left + 1;
    desk
      .querySelector(".board-shell")
      .style.setProperty("--columns", String(cols));
    desk
      .querySelector(".board-shell")
      .style.setProperty("--rows", String(bounds.rows));
  }
  async function click(a, v) {
    if(a.startsWith("map-card-")) {editCard(a.slice(9),v);return;}
    if (a==="map-workshop-back") { move("planner"); return; }
    if (a === "map-zoom") {
      const map=current();
      popup(`<h2>${esc(map.name)}</h2><img class="map-expanded" alt="${esc(map.name)}全图" src="img/${esc(map.id)}.webp">${W.act("map-gallery","看图选地图","btn light")}`);
      return;
    }
    if (a === "map-gallery") {
      popup(`<h2>选择地图</h2><div class="map-gallery">${W.data.garrison_maps.maps.map(z=>`<button data-w="map-select" data-v="${esc(z.id)}" aria-pressed="${z.id===base().map}"><img src="img/${esc(z.id)}.webp" alt=""><strong>${esc(z.name)}</strong></button>`).join("")}</div>`);
      return;
    }
    if (a === "map-select") {
      close(); const el=$("map-id"); el.value=v; el.dispatchEvent(new Event("change",{bubbles:true})); return;
    }
    if (a === "map-run-toggle") {
      db.prefs.mapRunOpen = !db.prefs.mapRunOpen;
      persist(); render();
      return;
    }
    if (a === "map-next-round") {
      db.run.round = Math.min(GuideModel.maxRound, db.run.round+1);
      Economy.changed(db.run, "round");
      if (db.prefs.autoStage) Teams.roundChanged();
      persist(); render(); renderBasket();
      return;
    }
    if (a === "map-cancel") {
      cancelCalculation();
      return;
    }
    if (a === "map-restore") {
      await calculate("placement");
      return;
    }
    if (a === "map-tab") {
      base().tab = v;
      selected = "";
      persist();
      render();
      return;
    }
    if (a === "map-mode-set" || a === "map-count-set") {
      const m = base();
      if (a === "map-count-set" && sheet().pins.length > Number(v)) {
        toast("请先解除一个固定位置");
        return;
      }
      if (a === "map-mode-set") m.mode = Number(v);
      else m.people = Number(v);
      persist();
      render();
      if (candidates().length) await calculate("placement");
      return;
    }
    if (a === "map-route-filter") {
      base().filter = v;
      persist();
      render();
      return;
    }
    const m = base(),
      sh = sheet(),
      eligible = Object.keys(W.profiles).filter(
        (n) => W.profiles[n]?.normalRange?.base,
      );
    if (a === "map-pool" || a === "map-counts") {
      cancelCalculation(false);
      QuickRoster.open({title:m.source === "owned" ? "快调本局干员" : "快调试摆干员",
        pool:m.pool, names:(m.source === "owned" ? Object.keys(W.rawOps) : eligible).filter(n=>!W.isBanned(n)), only:a === "map-counts",
        apply(pool) { m.pool = pool; inspecting = false; sync(); }
      });
      return;
    }
    if (a === "map-team" || a === "map-owned") {
      const team = active();
      if (a === "map-team" && !team) { toast("先打开或新建一套阵容"); return; }
      const pool = a === "map-owned" ? QuickRoster.owned() :
        QuickRoster.fromStage(team.stages[stageNum(team)]).filter(p=>eligible.includes(p.name));
      if (a === "map-team" && !pool.length) { toast("当前阶段没有可部署干员"); return; }
      m.source = a === "map-owned" ? "owned" : "trial";
      m.pool = pool;
      inspecting = false;
      sync();
      return;
    }
    if (a === "map-solve" || a === "map-evaluate") {
      if (!busy) await calculate(a === "map-solve" ? "placement" : "evaluate");
      return;
    }
    if (a === "map-finish-edit") {
      inspecting = false;
      selected = "";
      await calculate("placement");
      return;
    }
    if (a === "map-arm-move") {
      inspecting = false;
      toast("点目标格移动或换位");
      render();
      return;
    }
    if (a === "map-piece") {
      inspecting = false;
      selected = v;
      render();
      return;
    }
    if (a === "map-cell") {
      const [x, y] = v.split(",").map(Number);
      const currentKey = Object.keys(sh.placed).find(
        (k) => sh.placed[k].cell.col === x && sh.placed[k].cell.row === y,
      );
      if (selected && !inspecting) {
        moveTo(selected, x, y);
      } else if (currentKey) {
        cancelCalculation(false);
        inspecting = true;
        selected = currentKey;
        render();
      } else toast("先从下方选择一名干员");
      return;
    }
    if (a === "map-deselect") {
      selected = "";
      render();
      return;
    }
    if (a === "map-turn" && sh.placed[selected]) {
      sh.placed[selected].facing = (sh.placed[selected].facing + 1) % 4;
      invalidate();
      return;
    }
    if (a === "map-pin") {
      sh.pins = sh.pins.includes(selected)
        ? sh.pins.filter((n) => n !== selected)
        : [...sh.pins, selected];
      invalidate();
      return;
    }
    if (a === "map-bench") {
      delete sh.placed[selected];
      sh.pins = sh.pins.filter((k) => k !== selected);
      invalidate();
      return;
    }
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-map-number]");
    if (!b || !selected || !inspecting || db.page !== "map") return;
    const name = getName(selected);
    const m = base(), unit = m.pool.find(p=>p.name === name);
    if (!unit) return;
    QuickRoster.setNumber(unit, b.dataset.mapNumber, Number(b.dataset.number));
    if (!unit.count) m.pool = m.pool.filter(p=>p !== unit);
    if (!candidates().some(p=>p.key === selected)) selected = unit.count ? name : "";
    sync(false);
  });
  document.addEventListener("change", (e) => {
    if (!db || db.page !== "map") return;
    const m = base(),
      el = e.target;
    if (el.id === "map-id") {
      m.map = el.value;
      selected = "";
    } else if (el.id === "map-routes") {
      m.routes = el.checked;
      persist();
      render();
      return;
    } else if (el.id === "map-people") {
      if (Object.keys(sheet().placed).length > Number(el.value)) {
        el.value = m.people;
        toast("请先将一名干员下场");
        return;
      }
      m.people = Number(el.value);
    } else if (el.id === "map-mode") m.mode = Number(el.value);
    else return;
    cancelCalculation();
    persist();
    render();
    if (candidates().length) {
      const sh = sheet();
      const manual = sh.manual ?? (Object.keys(sh.placed).length > 0 && !sh.recommended);
      void calculate(manual ? "evaluate" : "placement");
    }
  });
  document.addEventListener("dragstart", (e) => {
    const k = e.target.closest("[data-piece]")?.dataset.piece;
    if (k) e.dataTransfer.setData("text/plain", k);
  });
  document.addEventListener("dragover", (e) => {
    if (e.target.closest(".tile")) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    const tile = e.target.closest(".tile");
    if (!tile) return;
    e.preventDefault();
    const k = e.dataTransfer.getData("text/plain");
    if (!candidates().some((p) => p.key === k)) return;
    selected = k;
    moveTo(k, ...tile.dataset.v.split(",").map(Number));
  });
  return { render, click, openWorkshop, leaveWorkshop, candidates, ownedChanged, showInitial, savedField, waitingForRoster, restoreRosterSource, bansChanged };
})();
