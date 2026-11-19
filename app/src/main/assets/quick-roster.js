"use strict";
const QuickRoster = (() => {
  const W = Workbench;
  let draft;
  function mergeSize(name) {
    return info("op:"+name).normal?.includes("只需两名本干员即可合成精锐") ? 2 : 3;
  }
  function normalize(unit) {
    const count = Math.max(0, Math.trunc(Number(unit.count) || 0));
    const elite = Math.max(0, Math.min(count, Math.trunc(Number(unit.elite) || 0)));
    const cost = mergeSize(unit.name), plain = count - elite;
    unit.elite = elite + Math.floor(plain / cost);
    unit.count = unit.elite + plain % cost;
    return unit;
  }
  function normalizeOwned(name) {
    const u = normalize({name,count:db.run.counts[name],elite:db.run.elite[name]});
    db.run.counts[name] = u.count;
    if (u.elite) db.run.elite[name] = u.elite;
    else delete db.run.elite[name];
  }
  function rawCopies(unit) {
    return unit.count + (mergeSize(unit.name) - 1) * unit.elite;
  }
  function purchaseFloor(unit, n) {
    unit.count += Math.max(0, n - rawCopies(unit));
    return normalize(unit);
  }
  function owned() {
    return Object.entries(db.run.counts).filter(([,n]) => n > 0)
      .map(([name, count]) => normalize({name, count, elite: db.run.elite[name] || 0}));
  }
  function setOwned(pool) {
    db.run.counts = Object.fromEntries(pool.map(p => [p.name, p.count]));
    db.run.elite = Object.fromEntries(pool.filter(p => p.elite).map(p => [p.name, p.elite]));
  }
  function fromStage(stage) {
    const rows = new Map();
    for (const e of stage.entries.filter(e => e.key.startsWith("op:"))) {
      const name = e.key.slice(3);
      if (!rows.has(name)) rows.set(name, {name, count:0, elite:0});
      const u = rows.get(name);
      u.count++;
      if (e.elite) u.elite++;
    }
    return [...rows.values()].map(normalize);
  }
  function applyStage(stage, pool) {
    const keep = new Set(stage.entries.filter(e => !e.key.startsWith("op:")));
    const added = [];
    for (const p of pool) {
      const original = stage.entries.filter(e => e.key === "op:" + p.name);
      const rows = [
        ...original.filter(e => e.elite).slice(0, p.elite),
        ...original.filter(e => !e.elite).slice(0, p.count - p.elite),
      ];
      for (const e of original)
        if (rows.length < p.count && !rows.includes(e)) rows.push(e);
      rows.forEach(e => keep.add(e));
      while (rows.length < p.count) {
        const row = {key:"op:" + p.name};
        rows.push(row);
        added.push(row);
      }
      // Keep equipment, notes, slot order and already-elite copies wherever possible.
      const ordered = [...rows].sort((a,b) => Number(!!b.elite) - Number(!!a.elite));
      ordered.forEach((e,i) => {
        const elite = i < p.elite;
        if (!!e.elite === elite) return;
        e.elite = elite;
        const detail = (e.detail || "").split(" · ").filter(x => x && x !== "精锐");
        e.detail = (elite ? ["精锐", ...detail] : detail).join(" · ");
      });
    }
    stage.entries = [...stage.entries.filter(e => keep.has(e)), ...added];
  }
  function numbers(unit, action) {
    const cost = mergeSize(unit.name), plain = unit.count - unit.elite;
    function choice(key, value, label, pressed) {
      return `<button type="button" data-${action}="${key}" data-number="${value}" ${pressed === undefined ? "" : `aria-pressed="${pressed}"`}>${label}</button>`;
    }
    const plainChoices = Array.from({length:cost},(_,i)=>choice("normal",i,i,plain===i)).join("");
    const eliteChoices = [...new Set([0,1,unit.elite])].sort((a,b)=>a-b).map(i=>choice("elite",i,i,unit.elite===i)).join("");
    return `<div class="number-choices"><small>普通</small><div role="group" aria-label="${esc(unit.name)} 普通">${plainChoices}
      ${choice("buy",1,plain === cost-1 ? "购入第 " + cost + " 名 → 精锐" : "购入 1 名")}</div></div>
      <div class="number-choices"><small>精锐</small><div role="group" aria-label="${esc(unit.name)} 精锐">${eliteChoices} ${plain > 0 ? choice("one-elite",1,"仅 1 精锐") : ""}
      ${unit.elite > 2 ? choice("elite",unit.elite-1,"减 1") : ""}</div></div>`;
  }
  function setNumber(unit, key, n) {
    if (!unit || !Number.isSafeInteger(n) || n < 0) return;
    const plain = unit.count-unit.elite, cost=mergeSize(unit.name);
    if (key === "normal" && n < cost) unit.count = unit.elite + n;
    else if (key === "elite" && n <= Math.max(1,unit.elite)) { unit.elite = n; unit.count = plain + n; }
    else if (key === "one-elite") { unit.count = 1; unit.elite = 1; }
    else if (key === "buy") { unit.count++; normalize(unit); }
    else if (key === "remove") { unit.count=0; unit.elite=0; }
  }
  function pane() {
    const p = draft.rows.get(draft.focus);
    $("quick-numbers").innerHTML = p ? `<strong>${esc(p.name)}</strong>${numbers(p,"quick-number")}` : '<p class="hint">点干员头像加入并调整数量。</p>';
    $("quick-size").textContent = "已选 " + [...draft.rows.values()].filter(p => p.count).length + " 名";
  }
  function paintCard(el) {
    const p = draft.rows.get(el.dataset.unit);
    el.classList.toggle("chosen", !!p?.count);
    el.classList.toggle("focused", el.dataset.unit === draft.focus);
    el.querySelector("[data-quick-focus]").setAttribute("aria-pressed", String(el.dataset.unit === draft.focus));
    const toggle = el.querySelector("[data-quick-toggle]");
    toggle.textContent = p?.count ? "✓" : "＋";
    toggle.setAttribute("aria-pressed", String(!!p?.count));
    toggle.setAttribute("aria-label", (p?.count ? "移除 " : "加入 ") + el.dataset.unit);
    el.querySelector("small").textContent = p?.count ? (p.count-p.elite)+" 普通 · "+p.elite+" 精锐" : info("op:"+el.dataset.unit).tier+" 阶";
  }
  function grid() {
    const tier = $("quick-tier").value, job = $("quick-job").value, bond = $("quick-bond").value;
    const names = draft.names.filter(n => (!draft.only || draft.rows.get(n)?.count) &&
      (!tier || String(info("op:"+n).tier) === tier) && (!job || W.profiles[n]?.profession === job) &&
      (!bond || info("op:"+n).tags.includes(bond)));
    const host = $("quick-grid");
    host.innerHTML = names.map(n => `<div class="quick-card" data-unit="${esc(n)}">
      <button type="button" data-quick-focus>${portrait("op:"+n)}<span><strong>${esc(n)}</strong><small></small></span></button>
      <button type="button" data-quick-toggle></button></div>`).join("") || '<p class="hint">没有符合筛选的干员。</p>';
    host.querySelectorAll("[data-unit]").forEach(paintCard);
  }
  function refresh(oldName) {
    pane();
    const host = $("quick-grid");
    for (const n of new Set([oldName, draft.focus])) {
      if (!n) continue;
      const el = host.querySelector('[data-unit="' + CSS.escape(n) + '"]');
      if (!el) continue;
      if (draft.only && !draft.rows.get(n)?.count) el.remove();
      else paintCard(el);
    }
  }
  function open({title, pool, names, apply, addBought = false, only = false}) {
    const current = new Set(pool.map(p => p.name));
    const all = [...new Set([...names, ...current])];
    all.sort((a,b) => Number(current.has(b)) - Number(current.has(a)) || (info("op:"+a).tier || 0) - (info("op:"+b).tier || 0));
    draft = {rows:new Map(pool.map(p=>[p.name,{...p}])), names:all, focus:pool[0]?.name, only:only && pool.length > 0, apply};
    const jobs = [...new Set(all.map(n => W.profiles[n]?.profession).filter(Boolean))];
    const select = (id, label, items) => `<label>${label}${W.select(id,[["","全部"],...items],"")}</label>`;
    popup(`<div class="quick-editor"><h2>${esc(title)}</h2><div class="quick-controls">
      ${select("quick-tier","等阶",[1,2,3,4,5,6])}${select("quick-job","职业",jobs)}${select("quick-bond","盟约",W.data.covenants.covenants.map(b=>b.name))}
      <label><input type="checkbox" id="quick-only" ${draft.only ? "checked":""}>只看已选</label></div>
      <div id="quick-numbers"></div><div id="quick-grid"></div><div class="actions quick-footer">
      <button type="button" data-quick-save class="btn gold">应用整队</button>${addBought ? '<button type="button" data-quick-bought class="btn light">补入已购干员</button>' : ""}
      ${button("cancel","取消","btn light")}<span id="quick-size" class="hint"></span></div></div>`);
    pane();
    grid();
  }
  document.addEventListener("change", e => {
    if (!e.target.closest(".quick-controls")) return;
    draft.only = $("quick-only").checked;
    grid();
  });
  document.addEventListener("click", e => {
    const b = e.target.closest(".quick-editor button");
    if (!b || !draft) return;
    const old = draft.focus;
    if (b.hasAttribute("data-quick-save")) {
      const result = [...draft.rows.values()].filter(p => p.count > 0);
      const apply = draft.apply;
      draft = null;
      close();
      apply(result);
      return;
    }
    if (b.hasAttribute("data-quick-bought")) {
      for (const team of db.teams) for (const token of team.owned) {
        const [key, count] = JSON.parse(token);
        if (!key.startsWith("op:")) continue;
        const name = key.slice(3), p = draft.rows.get(name) || {name,count:0,elite:0};
        purchaseFloor(p, count);
        draft.rows.set(name, p);
        draft.focus ||= name;
      }
      pane(); grid();
      return;
    }
    if (b.dataset.quickNumber) {
      setNumber(draft.rows.get(old), b.dataset.quickNumber, Number(b.dataset.number));
      refresh(old);
      return;
    }
    const name = b.closest("[data-unit]")?.dataset.unit;
    if (!name) return;
    const p = draft.rows.get(name) || {name, count:0, elite:0};
    if (b.hasAttribute("data-quick-toggle") && p.count) setNumber(p,"remove",0);
    else if (!p.count) p.count = 1;
    draft.rows.set(name, p);
    draft.focus = name;
    refresh(old);
  });
  return {open, owned, setOwned, fromStage, applyStage, numbers, setNumber, normalize, normalizeOwned, rawCopies, purchaseFloor};
})();
