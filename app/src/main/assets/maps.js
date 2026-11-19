"use strict";
const Maps = (() => {
  const W = Workbench;
  let countDraft = [];
  function countRow(p, i) {
    function choices(key, label, first, last) {
      const buttons = Array.from({ length: last - first + 1 }, (_, j) => {
        const n = first + j;
        return `<button type="button" data-w="map-count-pick" data-v="${i}/${key}/${n}" aria-label="${esc(p.name)} ${label} ${n}" aria-pressed="${p[key] === n}">${n}</button>`;
      }).join("");
      return `<div class="number-choices" role="group" aria-label="${esc(p.name)} ${label}"><small>${label}</small><div>${buttons}</div></div>`;
    }
    return `<div class="count-name">${portrait("op:" + p.name)}<strong>${esc(p.name)}</strong></div>${choices("count", "数量", 1, 9)}${choices("elite", "精锐", 0, p.count)}`;
  }
  let selected = "",
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
  function base() {
    const m = (db.board ||= {
      map: W.data.garrison_maps.maps[0].id,
      people: 8,
      mode: 1,
      pool: [],
      layouts: {},
      routes: true,
    });
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
  function candidates() {
    return base().pool.flatMap((p) =>
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
  function selectPool(names) {
    const s = base(),
      old = new Map(s.pool.map((p) => [p.name, p]));
    s.pool = names.map((n) => old.get(n) || { name: n, count: 1, elite: 0 });
    sync();
  }
  function sync() {
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
    persist();
    render();
    if (keys.size) void calculate("placement");
    else cancelCalculation();
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
  function invalidate() {
    sheet().total = null;
    sheet().checks = [];
    sheet().active = [];
    persist();
    render();
    if (Object.keys(sheet().placed).length) void calculate("evaluate");
    else cancelCalculation();
  }
  function cancelCalculation() {
    if (!busy) return;
    ++job;
    busy = false;
    runningKey = "";
    W.stopMap();
    if (db.page === "map") render();
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
    cancelCalculation();
    if (action === "placement" && sh.recommended?.key === key) {
      const { placed, total, active, checks } = sh.recommended;
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
      min = W.data.garrison_maps.columns[0];
    const selectedPiece = sh.placed[selected];
    const roles = ["输出", "承伤", "辅助", "叠层"];
    const sub = m.tab || "board";
    const tabs = `<div class="tracking-tabs">${[
      ["shop", "购买清单"],
      ["owned", "干员状态"],
      ["board", "地图模拟"],
    ]
      .map(([id, name]) =>
        W.act("map-tab", name, sub === id ? "chosen" : "", id),
      )
      .join("")}</div>`;
    if (sub !== "board") {
      if (sub === "owned") {
        const names = Object.keys(db.run.counts).filter(
          (n) => db.run.counts[n] > 0,
        );
        desk.innerHTML =
          tabs +
          section(
            "实际拥有的干员",
            W.act("owned", "编辑持有数量与精锐", "btn light"),
          ) +
          `<div class="unitgrid">${names.map((n) => `<div class="unit">${portrait("op:" + n)}<div><strong>${esc(n)}</strong><small>持有 ${db.run.counts[n]} · 精锐 ${db.run.elite[n] || 0}</small></div></div>`).join("")}</div>` +
          (names.length
            ? ""
            : empty("尚未录入干员", "勾选已购干员或在这里编辑实际拥有池。"));
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
      selectedCandidate = pool.find((p) => p.key === selected),
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
          return `<button class="${tileClass}" data-w="map-cell" data-v="${code}" aria-label="${esc(label + " " + types[type] + (k ? " " + k : ""))}" ${k ? `data-piece="${esc(k)}" draggable="true"` : ""}>${k ? `<span class="piece">${portrait("op:" + getName(k))}<b>${sh.pins.includes(k) ? "•" : ""}${faces[piece.facing]}</b></span>` : ""}</button>`;
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
        .map((k) => pool.find((p) => p.key === k))
        .filter(Boolean),
      bench = pool.filter((p) => !sh.placed[p.key]),
      count = field.length;
    function card(p) {
      const piece = sh.placed[p.key],
        role = piece?.role;
      return `<button class="deploy-card role-${role ?? "bench"} ${selected === p.key ? "active-unit" : ""}" draggable="true" data-piece="${esc(p.key)}" data-w="map-piece" data-v="${esc(p.key)}">${portrait("op:" + p.name)}<span class="deploy-name"><strong>${esc(p.key)}${p.isElite ? " · 精" : ""}</strong><small>${esc(info("op:" + p.name).tags.join(" · "))}</small></span>${piece && sh.pins.includes(p.key) ? "<i aria-label='已固定'>●</i>" : ""}<span class="role-label">${roles[role] || "备选"}</span></button>`;
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
    desk.innerHTML = `<div class="deploy-layout">${tabs}<div class="map-head"><img alt="" src="img/${esc(map.id)}.webp"><div><strong>${esc(map.name)}</strong> <span>● 手动</span><small>终端 ${db.run.terminal} 级${sh.active?.length ? " · " + esc(sh.active.join(" · ")) : ""}</small></div><label class="map-change" aria-label="切换地图">⇄${W.select(
      "map-id",
      W.data.garrison_maps.maps.map((z) => [z.id, z.name]),
      m.map,
    )}</label></div>
      <div class="deploy-modes"><div class="tracking-tabs">${["战斗", "平衡", "叠层"].map((n, i) => W.act("map-mode-set", n, m.mode === i ? "chosen" : "", "" + i)).join("")}</div><div class="tracking-tabs">${[8, 9].map((i) => W.act("map-count-set", i, m.people === i ? "chosen" : "", "" + i)).join("")}</div></div>
      <article class="board-panel"><div class="board-shell"><div class="board-cols">${axisCols}</div><div class="board-rows">${axisRows}</div><div class="board">${grid}${m.routes ? routeLayer(map, min, m.filter || "both") : ""}</div></div>
      <div class="plan-checks" aria-label="站位校验" aria-live="polite">${flags || `<span class="hint">${busy ? "正在计算站位校验…" : count ? "正在评估当前摆位…" : "选择干员并推荐站位后，显示盟约、上下路阻挡与治疗。"}</span>`}</div></article>
      ${field.length ? `<div class="deploy-roster">${field.map(card).join("")}</div>` : ""}
      ${selected ? `<div class="selected-piece"><strong>${esc(selected)}${roles[selectedPiece?.role] ? " · " + roles[selectedPiece.role] : ""}</strong><div class="actions">${selectedPiece ? W.act("map-turn", "转向 " + faces[selectedPiece.facing]) + W.act("map-pin", sh.pins.includes(selected) ? "解除固定" : "固定位置") + W.act("map-bench", "下场") : "<small>点一个可用格子部署</small>"}${W.act("map-deselect", "取消选择", "linkbtn")}</div>${selectedPiece?.notes ? `<p class="hint">${esc(selectedPiece.notes.join(" · "))}</p>` : ""}</div>` : ""}
      <div class="bench-head"><strong>整备区 · ${bench.length} 人</strong><span>上场 ${count} · 已获取 ${new Set(pool.map((p) => p.name)).size} 名</span>${W.act("map-pool", "干员池 ›", "linkbtn")}</div>
      ${bench.length ? `<div class="deploy-roster">${bench.map(card).join("")}</div>` : ""}
      <div class="deploy-tools actions">${W.act("map-solve", busy ? status : "推荐站位", "btn gold")}${busy ? W.act("map-cancel", "取消计算", "linkbtn") : ""}${W.act("map-team", "使用当前阵容")}${W.act("map-owned", "使用实际拥有池")}${W.act("map-counts", "数量与精锐")}${W.act("map-evaluate", "评估当前摆位", "linkbtn")}</div>
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
    if (a === "map-pool") {
      W.picker(
        "选择可部署干员",
        W.opChoices(eligible),
        m.pool.map((p) => p.name),
        selectPool,
        35,
      );
      return;
    }
    if (a === "map-team" || a === "map-owned") {
      const entries =
        a === "map-team"
          ? active()
              ?.stages[stageNum(active() || { stages: [{}] })].entries.filter(
                (e) => e.key.startsWith("op:"),
              )
              .map((e) => e.key.slice(3))
          : Object.keys(db.run.counts).filter((n) => db.run.counts[n] > 0);
      if (!entries?.length) {
        toast(
          a === "map-team"
            ? "先打开或新建一套阵容"
            : "先到对局页录入实际拥有的干员",
        );
        return;
      }
      const names = [...new Set(entries)].filter((n) => eligible.includes(n));
      if (!names.length) {
        toast("这些干员缺少部署资料");
        return;
      }
      m.pool = names.map((n) => ({
        name: n,
        count:
          a === "map-owned"
            ? db.run.counts[n]
            : entries.filter((k) => k === n).length,
        elite:
          a === "map-owned"
            ? db.run.elite[n] || 0
            : active().stages[stageNum(active())].entries.find(
                  (e) => e.key === "op:" + n,
                )?.elite
              ? 1
              : 0,
      }));
      sync();
      return;
    }
    if (a === "map-solve" || a === "map-evaluate") {
      if (!busy) await calculate(a === "map-solve" ? "placement" : "evaluate");
      return;
    }
    if (a === "map-piece") {
      selected = v;
      render();
      return;
    }
    if (a === "map-cell") {
      const [x, y] = v.split(",").map(Number);
      const currentKey = Object.keys(sh.placed).find(
        (k) => sh.placed[k].cell.col === x && sh.placed[k].cell.row === y,
      );
      if (selected) {
        moveTo(selected, x, y);
      } else if (currentKey) {
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
    if (a === "map-counts") {
      countDraft = m.pool.map((p) => ({ ...p }));
      popup(
        `<h2>数量与精锐</h2><div class="count-list">${countDraft.map((p, i) => `<div class="count-row" id="count-row-${i}">${countRow(p, i)}</div>`).join("") || "<p>先选择干员池，再设置数量。</p>"}</div><div class="actions count-footer">${W.act("map-count-save", "保存", "btn gold")}${button("cancel", "取消", "btn light")}</div>`,
      );
      return;
    }
    if (a === "map-count-pick") {
      const [index, key, n] = v.split("/"),
        p = countDraft[Number(index)],
        num = Number(n);
      if (!p || !Number.isInteger(num)) return;
      if (key === "count" && num >= 1 && num <= 9) {
        p.count = num;
        p.elite = Math.min(p.elite, num);
      }
      if (key === "elite" && num >= 0 && num <= p.count) p.elite = num;
      $("count-row-" + index).innerHTML = countRow(p, Number(index));
      return;
    }
    if (a === "map-count-save") {
      m.pool = countDraft.map((p) => ({ ...p }));
      close();
      sync();
      return;
    }
  }
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
  return { render, click };
})();
