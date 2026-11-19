"use strict";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clone = (value) => JSON.parse(JSON.stringify(value));
const key = "hongxue.tablet.v1";
const fresh = () => ({
  version: 1,
  imports: [],
  teams: [],
  active: null,
  page: "library",
  detail: null,
});
let db,
  bundled = { guides: [] },
  catalogue = {},
  query = "",
  previewStage = 0,
  timer,
  picker,
  importSequence = 0;
const desk = $("desk"),
  basket = $("basket"),
  dialog = $("dialog"),
  body = $("dialogBody");
const sources = () => [...GuideModel.offline, ...db.imports, ...bundled.guides];
const active = () => db.teams.find((x) => x.id === db.active);
const viewing = () =>
  (db.page === "teams" ? db.teams : sources()).find((x) => x.id === db.detail);
function tag(s) {
  return `<span class="tag">${esc(s)}</span>`;
}
function button(action, text, cls = "btn light", attrs = "") {
  return `<button type="button" class="${cls}" data-act="${action}" ${attrs}>${esc(text)}</button>`;
}
function attr(name, value) {
  return `data-${name}="${esc(value)}"`;
}
function idButton(action, text, id, cls = "btn light") {
  return button(action, text, cls, attr("id", id));
}
function persist() {
  try {
    localStorage.setItem(key, JSON.stringify(db));
  } catch (_) {
    toast("本地空间不足，刚才的修改无法保存。");
    return false;
  }
  return true;
}
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").className = "show";
  clearTimeout(timer);
  timer = setTimeout(() => ($("toast").className = ""), 2800);
}
function popup(html) {
  body.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function close() {
  if (dialog.open) dialog.close();
}
function portrait(id) {
  const item = catalogue[id];
  return item
    ? `<img loading="lazy" class="portrait" alt="" src="${esc(item.image)}">`
    : `<span class="fallback" aria-hidden="true">${esc(id.slice(3, 4))}</span>`;
}
function info(id) {
  return (
    catalogue[id] || {
      name: id.slice(3),
      kind: id.startsWith("op:") ? "op" : "eq",
      tags: [],
    }
  );
}
function identity(options) {
  return options.filter(Boolean).map(esc).join(" · ");
}
function equipmentTiers() {
  return [...new Set(Workbench.data.equipment.equipment.map(e => e.tier))].sort((a, b) => a - b);
}
function equipmentTierButtons(selected, action) {
  return `<div class="facet-row equipment-tiers" aria-label="装备等阶"><b>等阶</b><div>${["", ...equipmentTiers().map(String)].map(n =>
    `<button type="button" ${action} data-v="${n}" aria-pressed="${n ? selected.includes(n) : !selected.length}">${n ? n + " 阶" : "全部"}</button>`).join("")}</div></div>`;
}
function equipmentGroups(items, keyOf, card) {
  const groups = new Map();
  for (const item of items) {
    const tier = info(keyOf(item)).tier || 0;
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push(item);
  }
  return [...groups.keys()].sort((a,b) => (a || Infinity) - (b || Infinity)).map(tier => {
    const entries = groups.get(tier);
    return `<h3 class="equipment-tier-heading">${tier ? tier + " 阶" : "等阶待定"}<small>${entries.length} 件</small></h3>` + entries.map(card).join("");
  }).join("");
}
function equipmentEffects(item) {
  return `<span class="equipment-effects"><span><b>普通</b><span>${esc(item.normal)}</span></span>${item.elite
    ? `<span><b>精锐</b><span>${esc(item.elite)}</span></span>`
    : '<small>无精锐装备</small>'}</span>`;
}
function facts(entry) {
  const item = info(entry.key);
  const labels = entry.labels || [];
  const details = entry.detail
    ?.split(" · ")
    .filter((l) => !labels.includes(l))
    .join(" · ");
  const chips = labels
    .map(
      (l) =>
        `<span class="manual-role" data-label="${esc(l)}">${esc(l)}</span>`,
    )
    .join("");
  return `<div><strong>${esc(item.name)}</strong><small>${details ? esc(details) : identity([item.tier && item.tier + " 阶", ...(item.tags || []).slice(0, 2)])}</small>${chips}</div>`;
}
function stageNum(team) {
  return Math.max(0, Math.min(team.stage || 0, team.stages.length - 1));
}
function stageTabs(stages, index, action) {
  return `<div class="tabrow" aria-label="选择阶段">${stages.map((s, i) => button(action, GuideModel.stageText(s), i === index ? "chosen" : "", attr("index", i))).join("")}</div>`;
}
function move(page, detail = null) {
  db.page = page;
  db.detail = detail;
  query = "";
  previewStage = 0;
  persist();
  render();
  window.scrollTo(0, 0);
}
function render() {
  document
    .querySelectorAll("nav button")
    .forEach((b) =>
      b.setAttribute(
        "aria-current",
        b.dataset.act === db.page ? "page" : "false",
      ),
    );
  if (Workbench.renderPage()) {
    renderBasket();
    return;
  }
  const record = viewing();
  if (record) renderDetail(record);
  else if (db.page === "teams") renderTeams();
  else renderLibrary();
  renderBasket();
}
function renderLibrary() {
  desk.innerHTML = `<div class="topline"><div><h1>攻略库</h1><p class="sub">选一篇攻略，按阶段查看干员与装备。</p></div>${button("import", "＋ 导入攻略", "btn")}</div>
    <input id="guideSearch" class="search" type="search" aria-label="搜索攻略" placeholder="搜索攻略、盟约或干员" value="${esc(query)}"><div id="shelf"></div>`;
  renderShelf();
}
function matches(g, q) {
  return [
    g.title,
    g.author,
    ...(g.tags || []),
    ...g.stages.flatMap((s) => s.entries.map((e) => e.key.slice(3))),
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}
function listRow(act, id, title, sub) {
  return `<button class="listrow" data-act="${act}" ${attr("id", id)}><span><strong>${esc(title)}</strong><small class="hint">${esc(sub)}</small></span><span class="arrow" aria-hidden="true">›</span></button>`;
}
function section(title, extra = "") {
  return `<div class="sectionhead"><h3>${esc(title)}</h3>${extra}</div>`;
}
function empty(title, desc) {
  return `<div class="empty"><strong>${esc(title)}</strong>${esc(desc)}</div>`;
}
function renderShelf() {
  const q = query.trim().toLowerCase(),
    locals = GuideModel.offline.filter((g) => matches(g, q));
  const imports = db.imports.filter((g) => matches(g, q));
  const packaged = bundled.guides.filter((g) => matches(g, q));
  const online = GuideModel.featured.filter(
    (g) =>
      [g.title, g.author].some((x) => x.toLowerCase().includes(q)) &&
      !db.imports.some((r) => r.id === "sk-" + g.id),
  );
  const cards = locals
    .map((g) => {
      const i = GuideModel.offline.indexOf(g);
      return `<button class="guidecard" data-act="guide" ${attr("id", g.id)}><div class="cover c${i}">${g.cover.map((n) => portrait("op:" + n)).join("")}</div><div class="cardbody"><h3>${esc(g.title)}</h3><p>${esc(g.blurb)}</p></div><div class="cardfooter"><span>${g.stages.length} 个阶段</span><span>查看 ›</span></div></button>`;
    })
    .join("");
  let html = locals.length
    ? section("离线参考阵容") + `<div class="shelves">${cards}</div>`
    : "";
  if (packaged.length)
    html +=
      section("森空岛高赞阵容 · " + packaged.length) +
      `<p class="hint">推荐前 20 页，超过 50 赞 · 已随包收录</p><div class="listbox packed-guides">${packaged.map((g) => listRow("guide", g.id, g.title, `👍 ${g.likes} · ${g.author} · ${g.stages.length} 个阶段 · 离线可读`)).join("")}</div>`;
  if (imports.length)
    html +=
      section("已导入的攻略") +
      `<div class="listbox">${imports.map((g) => listRow("guide", g.id, g.title, `${g.author} · ${g.stages.length} 个阶段 · 离线可读`)).join("")}</div>`;
  if (online.length)
    html +=
      section(
        "森空岛攻略",
        `<a class="external" href="${GuideModel.base}">浏览攻略站 ↗</a>`,
      ) +
      `<div class="listbox">${online.map((g) => listRow("online", g.id, g.title, g.author + " · 联网读取")).join("")}</div>`;
  if (!html)
    html = empty("没有找到匹配的攻略", "可以换个关键词，或从森空岛导入攻略。");
  $("shelf").innerHTML = html;
}
function renderTeams() {
  desk.innerHTML = `<div class="topline"><div><h1>我的阵容</h1><p class="sub">打开阵容即可同步右侧购买清单。</p></div>${button("new", "＋ 新建阵容", "btn")}</div>
    ${Teams.controls()}${
      db.teams.length
        ? section("已保存") +
          `<div class="listbox">${db.teams
            .filter(Teams.searched)
            .map((t) =>
              listRow(
                "open-team",
                t.id,
                t.title,
                `${t.stages.length} 个阶段 · ${t.stages[stageNum(t)].label}${t.id === db.active ? " · 清单使用中" : ""}`,
              ),
            )
            .join("")}</div>`
        : empty(
            "还没有自己的阵容",
            "可以从空白阵容开始，也可以从攻略复制干员与装备。",
          ) + button("library", "去攻略库", "linkbtn")
    }`;
}
function renderDetail(g) {
  const editing = db.page === "teams",
    i = editing ? stageNum(g) : previewStage,
    s = g.stages[i] || g.stages[0];
  const group = (kind, title) => {
    const entries = s.entries.filter((x) => x.key.startsWith(kind + ":"));
    return (
      section(`${title} · ${entries.length}`) +
      (entries.length
        ? `<div class="unitgrid">${entries.map((e) => `<button class="unit" data-act="item" ${attr("key", e.key)}>${portrait(e.key)}${facts(e)}</button>`).join("")}</div>`
        : `<p class="hint">此阶段未指定${title}。</p>`)
    );
  };
  const author = g.author
    ? "森空岛 · " + g.author
    : editing
      ? "自定义阵容"
      : "平板版参考阵容";
  desk.innerHTML = `${button(editing ? "teams" : "library", editing ? "‹ 我的阵容" : "‹ 攻略库", "back")}
    <div class="toolbar"><div><h2>${esc(g.title)}</h2><div class="meta">${esc(author)}${g.source ? `<a href="${GuideModel.base}/detail?guideId=${esc(GuideModel.guideId(g.source))}">查看原文 ↗</a>` : ""}</div></div>
    <div class="actions">${editing ? button("rename", "编辑阵容", "btn light") : button("copy", "复制为我的阵容", "btn gold")}</div></div>
    ${g.tags?.length ? `<div class="tags controls">${g.tags.map(tag).join("")}</div>` : ""}${g.blurb ? `<p class="sub">${esc(g.blurb)}</p>` : ""}
    ${!editing && g.likes ? `<div class="actions"><span class="tag">👍 ${esc(g.likes)} · 内置阵容</span>${idButton("online", "联网读取作者讲解", g.id.slice(3), "linkbtn")}</div>` : ""}
    ${editing ? Teams.pane(g) : ""}${stageTabs(g.stages, i, "detail-stage")}
    ${s.note || editing ? `<div class="note">${esc(s.note || "可在「编辑阶段」里写下运营思路。")}</div>` : ""}
    ${s.bonds?.length ? `<div class="tags controls">${s.bonds.map(tag).join("")}</div>` : ""}
    ${editing ? `<div class="actions">${button("stage-quick", "快调干员", "btn")}${button("pick", "配干员 / 装备", "btn light")}${button("stage-edit", "编辑阶段", "btn light")}${button("jump", "查看购买清单", "btn light narrow-only")}</div>` : ""}
    ${group("op", "干员")}${group("eq", "装备")}`;
}
function renderBasket() {
  const recommending = db.prefs.basketTab === "recommend";
  const tabs = `<div class="tracking-tabs basket-tabs" role="group" aria-label="购买清单与推荐阵容">${[["shop","购买清单"],["recommend","推荐阵容"]].map(([tab,title]) =>
    `<button data-act="basket-tab" data-tab="${tab}" class="${(tab === "recommend") === recommending ? "chosen" : ""}" aria-pressed="${(tab === "recommend") === recommending}">${title}</button>`).join("")}</div>`;
  if (recommending) {
    basket.innerHTML = tabs + RunLineups.view();
    return;
  }
  const t = active();
  if (!t) {
    basket.innerHTML = tabs + RunLineups.preview() + `${empty("还没有跟踪的阵容", "从攻略复制一份阵容，或自己挑选干员和装备，购买目标就会出现在这里。")}
    <div class="actions controls">${button("new", "新建阵容", "btn light")}</div>`;
    return;
  }
  const idx = stageNum(t),
    s = t.stages[idx],
    rows = Teams.basketRows();
  const done = rows.filter((x) => Teams.owned(x.token)).length;
  const group = (kind, label) => {
    const used = rows.filter((x) => x.key.startsWith(kind + ":"));
    if (!used.length) return "";
    return `<h4 class="groupname">${label}</h4><div>${used
      .map((e) => {
        const checked = Teams.owned(e.token);
        return `<label class="buyrow ${checked ? "done" : ""}"><input type="checkbox" data-buy="${esc(e.token)}" ${checked ? "checked" : ""} aria-label="${esc(info(e.key).name)} 已购买">${portrait(e.key)}${facts(e)}</label>`;
      })
      .join("")}</div>`;
  };
  basket.innerHTML = tabs + RunLineups.preview() + `<div class="basket-head"><div class="buytitle">${idButton("open-team", t.title, t.id, "linkbtn")}</div><span class="count">${done} / ${rows.length}</span></div>
    <label><span class="hint">当前阶段</span><select class="compact-select" id="basketStage" aria-label="购买清单阶段">${t.stages.map((st, i) => `<option value="${i}" ${i === idx ? "selected" : ""}>${esc(GuideModel.stageText(st))}</option>`).join("")}</select></label>
    <p class="hint">${s.rangeSource === "默认参考" ? "默认按 16 回合划分，可在「阶段与回合」调整。" : s.start ? "本阶段按指定回合范围执行。" : s.isFinal ? "成型目标按实际进度切换。" : "此阶段可手动切换。"}</p>
    <progress class="progress" value="${done}" max="${rows.length || 1}" aria-label="购买进度"></progress>
    ${rows.length ? group("op", "干员") + group("eq", "装备") : empty("当前阶段的清单是空的", "进入阵容，为这个阶段添加干员或装备。") + idButton("open-team", "去配阵容", t.id, "linkbtn")}
    ${Teams.reminderText(t)}${Teams.tracked().some((group) => group.owned.length) ? button("reset", "重开一局，清除勾选", "linkbtn") : ""}`;
}
function editStage(i) {
  const t = active();
  if (!t || !t.stages[i]) return;
  t.stage = i;
  persist();
  render();
}
function incorporate(g, stage = previewStage, owned = [], destination = "teams") {
  const id =
    globalThis.crypto?.randomUUID?.() ||
    String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  const t = {
    ...clone(g),
    id,
    stage: Math.min(stage, g.stages.length - 1),
    owned,
  };
  db.teams.unshift(t);
  db.active = t.id;
  close();
  move(destination, destination === "teams" ? t.id : null);
  return t;
}
function formField(label, id, value, multi = false) {
  const field = multi
    ? `<textarea id="${id}" rows="4" maxlength="4000">${esc(value)}</textarea>`
    : `<input id="${id}" maxlength="100" value="${esc(value)}" autocomplete="off">`;
  return `<label class="field"><span>${esc(label)}</span>${field}</label>`;
}
function titleDialog(mode) {
  const t = viewing(),
    st = t?.stages[stageNum(t)];
  if (mode === "new")
    popup(
      `<h2>新建阵容</h2>${formField("阵容名称", "name", "")}<p class="hint">可分别配置前期、中期、成型与挂件。</p>${button("create", "创建阵容", "btn gold")}`,
    );
  if (mode === "rename")
    popup(
      `<h2>编辑阵容</h2>${formField("阵容名称", "name", t.title)}<div class="actions">${button("save-name", "保存", "btn gold")}${button("delete", "删除这套阵容", "linkbtn danger")}</div>`,
    );
  if (mode === "stage-edit")
    popup(
      `<h2>编辑阶段</h2>${formField("阶段名称", "name", st.label)}${formField("运营思路", "note", st.note || "", true)}${button("save-stage", "保存阶段", "btn gold")}`,
    );
}
function renderPicker() {
  const cls = (k) => (picker.kind === k ? "chosen" : "");
  popup(`<h2>配置阶段需求</h2><div class="segments">${button("pick-kind", "干员", cls("op"), attr("kind", "op"))}${button("pick-kind", "装备", cls("eq"), attr("kind", "eq"))}</div>
    <input id="pickSearch" class="search" type="search" aria-label="搜索干员或装备" placeholder="搜名称、拼音首字母、盟约或功能" value="${esc(picker.q)}"><div class="toolbar controls"><label><input type="checkbox" id="onlyPicked" ${picker.only ? "checked" : ""}> 只看已选</label><span id="pickCount" class="hint"></span></div>
    ${picker.kind === "eq" ? equipmentTierButtons(picker.tiers || [], 'data-act="pick-eq-tier"') : ""}
    <div class="pickgrid" id="picks"></div><div class="actions">${button("apply-pick", "保存阶段需求", "btn gold")}${button("cancel", "取消", "btn light")}</div>`);
  fillPicker();
}
function fillPicker() {
  const counts = new Set(picker.entries.map((x) => x.key));
  let candidates = Object.keys(catalogue);
  for (const id of counts) if (!catalogue[id]) candidates.push(id);
  const q = picker.q.trim().toLowerCase();
  candidates = candidates.filter((k) => {
    const it = info(k);
    return (
      it.kind === picker.kind &&
      (picker.kind !== "eq" || !picker.tiers?.length || picker.tiers.includes(String(it.tier))) &&
      (!picker.only || counts.has(k)) &&
      [it.name, it.initials, ...it.tags, it.tier && it.tier + "阶"]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  });
  candidates.sort(
    (a, b) =>
      (info(a).tier || 99) - (info(b).tier || 99) ||
      info(a).name.localeCompare(info(b).name, "zh-CN"),
  );
  $("pickCount").textContent = `已选 ${picker.entries.length} 项`;
  const card = k => `<button class="pickitem ${counts.has(k) ? "chosen" : ""}" aria-pressed="${counts.has(k)}" data-act="toggle-pick" ${attr("key", k)}>${portrait(k)}${facts({ key: k })}<b>${counts.has(k) ? "✓" : "＋"}</b></button>`;
  $("picks").innerHTML = (picker.kind === "eq" ? equipmentGroups(candidates, k => k, card) : candidates.map(card).join("")) || `<p class="hint">没有匹配项</p>`;
}
function showItem(k) {
  const t = info(k);
  if (t.kind === "eq" && catalogue[k]) {
    const change = Workbench.equipmentChanges[t.name];
    popup(`<div class="detailshead">${portrait(k)}<div><h2>${esc(t.name)}</h2><p class="hint">${identity([t.tier + " 阶", ...t.tags, change && "转职 · " + change])}</p></div></div>${equipmentEffects(t)}`);
    return;
  }
  popup(`<div class="detailshead">${portrait(k)}<div><h2>${esc(t.name)}</h2><p class="hint">${identity([t.tier && t.tier + " 阶", t.custom && "自选干员", t.strategy && "策略专属", ...t.tags])}</p></div></div>
    ${
      [
        ["普通效果", t.normal],
        ["精锐效果", t.elite],
        [t.skill || "技能", t.skillText],
      ]
        .filter((x) => x[1])
        .map(([n, v]) => section(n) + `<p>${esc(v)}</p>`)
        .join("") || `<p>这项内容来自导入的攻略。</p>`
    }`);
}
function showImport(value = "") {
  popup(`<h2>导入森空岛攻略</h2><p class="sub">在攻略站打开一篇攻略，复制详情链接并粘贴到这里。导入后可以离线查看。</p>
    <a class="external controls" href="${GuideModel.base}">浏览攻略站 ↗</a>${formField("攻略详情链接", "guideUrl", value)}
    <div id="importMsg" class="error" role="status"></div><div class="actions">${button("do-import", "读取并保存攻略", "btn gold")}</div>`);
  $("guideUrl").maxLength = 3000;
}
async function importGuide(id) {
  const ticket = ++importSequence;
  const msg = $("importMsg");
  msg.textContent = "正在从森空岛读取…";
  const input = $("guideUrl"),
    b = body.querySelector('[data-act="do-import"]');
  b.disabled = true;
  input.disabled = true;
  try {
    const r = await fetch("/api/guide?id=" + encodeURIComponent(id), {
      cache: "no-store",
    });
    if (!r.ok) throw Error("未能连接森空岛，请检查网络后重试。");
    const g = GuideModel.fromSkland(await r.json(), id);
    if (!dialog.open || ticket !== importSequence) return;
    const next = db.imports.filter((old) => old.id !== g.id);
    next.unshift(g);
    const previous = db.imports;
    db.imports = next;
    if (!persist()) {
      db.imports = previous;
      throw Error("保存失败，请检查平板可用空间。");
    }
    close();
    move("library", g.id);
    toast("已保存到攻略库，可离线查看");
  } catch (e) {
    if (dialog.open && ticket === importSequence) {
      msg.textContent = e.message || "读取失败，请重试。";
      b.disabled = false;
      input.disabled = false;
    }
  }
}
function confirmDialog(title, message, action, label) {
  popup(
    `<h2>${esc(title)}</h2><p>${esc(message)}</p><div class="actions">${button(action, label, "btn")}${button("cancel", "取消", "btn light")}</div>`,
  );
}
function about() {
  popup(`<h2>马头·卫戍手册</h2><p>Android 平板移植版 1.0.3 · 适配目标为三星 Galaxy Tab S8+。</p>${section("项目与数据")}<p>基于 bingyunhe/hongxue-stronghold-companion（15c074d）与 Moonfair/ASP_Assistant。游戏数据来自原项目整理的 PRTS 等资料，角色与美术版权属于各权利人。攻略保留作者与森空岛来源。</p>
    ${section("本地保存")}<p>阵容与购买进度保存在这台设备。卸载应用或清除应用数据会移除记录。</p>
    <div class="actions">${button("legal", "许可与归属", "btn light")}</div>`);
}
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b || !db) return;
  const a = b.dataset.act,
    id = b.dataset.id,
    k = b.dataset.key,
    i = Number(b.dataset.index),
    t = viewing();
  if (a === "basket-tab") {
    db.prefs.basketTab = b.dataset.tab;
    persist();
    renderBasket();
    return;
  }
  if (a === "follow-run-lineup") {
    RunLineups.follow(b.dataset.origin, id, i);
    return;
  }
  if (a === "retry-run-field") {
    RunLineups.retryField();
    render();
    return;
  }
  if (a === "compute-run-target") {
    RunLineups.computeTarget();
    return;
  }
  if (a === "library" || a === "teams") {
    move(a);
    return;
  }
  if (a === "guide") {
    move("library", id);
    return;
  }
  if (a === "open-team") {
    db.active = id;
    move("teams", id);
    return;
  }
  if (a === "copy") {
    incorporate(t);
    toast("已复制阵容，清单可开始勾选");
    return;
  }
  if (a === "detail-stage") {
    if (db.page === "teams") editStage(i);
    else {
      previewStage = i;
      renderDetail(t);
    }
    return;
  }
  if (["new", "rename", "stage-edit"].includes(a)) {
    titleDialog(a);
    return;
  }
  if (a === "create" || a === "save-name" || a === "save-stage") {
    const value = $("name").value.trim();
    if (!value) {
      $("name").setCustomValidity("请填写名称");
      $("name").reportValidity();
      return;
    }
    if (a === "create") {
      previewStage = 0;
      incorporate({
        title: value,
        stages: ["前期", "中期", "成型", "挂件"].map((label) => ({
          label,
          ...GuideModel.defaultRange(label),
          entries: [],
          note: "",
        })),
      });
    } else {
      if (a === "save-name") t.title = value;
      else {
        const s = t.stages[stageNum(t)];
        s.label = value;
        s.note = $("note").value.trim();
      }
      persist();
      close();
      render();
    }
    return;
  }
  if (a === "stage-quick" && t) {
    const stage = t.stages[stageNum(t)];
    QuickRoster.open({title:"快调阶段干员", pool:QuickRoster.fromStage(stage), names:Object.keys(Workbench.rawOps),
      apply(pool) { QuickRoster.applyStage(stage, pool); persist(); render(); }
    });
    return;
  }
  if (a === "pick") {
    picker = {
      kind: "op",
      q: "",
      only: false,
      entries: clone(t.stages[stageNum(t)].entries),
    };
    renderPicker();
    return;
  }
  if (a === "pick-kind") {
    picker.kind = b.dataset.kind;
    picker.q = "";
    renderPicker();
    return;
  }
  if (a === "pick-eq-tier") {
    const v = b.dataset.v, tiers = picker.tiers || [];
    picker.tiers = v ? (tiers.includes(v) ? tiers.filter(n => n !== v) : [...tiers, v]) : [];
    renderPicker();
    return;
  }
  if (a === "toggle-pick") {
    const pos = picker.entries.findIndex((e) => e.key === k);
    if (pos >= 0) picker.entries = picker.entries.filter((e) => e.key !== k);
    else picker.entries.push({ key: k });
    fillPicker();
    return;
  }
  if (a === "apply-pick") {
    t.stages[stageNum(t)].entries = picker.entries;
    persist();
    close();
    render();
    return;
  }
  if (a === "item") {
    if (db.page === "teams" && viewing()) Teams.slotEditor(viewing(), k);
    else showItem(k);
    return;
  }
  if (a === "import") {
    showImport();
    return;
  }
  if (a === "online") {
    showImport(GuideModel.base + "/detail?guideId=" + id);
    await importGuide(id);
    return;
  }
  if (a === "do-import") {
    try {
      const gid = GuideModel.guideId($("guideUrl").value);
      await importGuide(gid);
    } catch (e) {
      $("importMsg").textContent = e.message;
    }
    return;
  }
  if (a === "delete") {
    confirmDialog(
      "删除这套阵容？",
      "该阵容和它的勾选记录将一起移除。",
      "delete-yes",
      "删除阵容",
    );
    return;
  }
  if (a === "delete-yes") {
    db.teams = db.teams.filter((x) => x.id !== t.id);
    if (db.active === t.id) db.active = db.teams[0]?.id || null;
    close();
    move("teams");
    return;
  }
  if (a === "reset") {
    confirmDialog(
      "开始新的一局？",
      "清空当前阵容所有阶段的购买勾选，保留阵容配置。",
      "reset-yes",
      "清除勾选",
    );
    return;
  }
  if (a === "reset-yes") {
    for (const group of Teams.tracked()) group.owned = [];
    db.run.counts = {};
    db.run.elite = {};
    persist();
    close();
      render();
    return;
  }
  if (a === "jump") {
    db.prefs.basketTab = "shop";
    persist();
    renderBasket();
    basket.scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (a === "about") {
    about();
    return;
  }
  if (a === "legal") {
    const texts = await Promise.all(
      [
        "NOTICE",
        "LICENSE",
        "LICENSE.upstream",
        "DOTNET-LICENSE.txt",
        "DOTNET-NOTICES.txt",
        "ASPNET-NOTICES.txt",
      ].map((name) => fetch("legal/" + name).then((r) => r.text())),
    );
    if (dialog.open)
      popup(
        "<h2>许可与归属</h2><pre class='legal'>" +
          esc(texts.join("\n\n")) +
          "</pre>",
      );
    return;
  }
  if (a === "cancel") close();
});
document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.id === "guideSearch") {
    query = el.value;
    renderShelf();
  }
  if (el.id === "pickSearch") {
    picker.q = el.value;
    fillPicker();
  }
  if (el.id === "name") el.setCustomValidity("");
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.id === "basketStage") {
    editStage(Number(el.value));
    return;
  }
  if (el.id === "onlyPicked") {
    picker.only = el.checked;
    fillPicker();
    return;
  }
  if (el.dataset.buy) {
    const t = active();
    Teams.mark(el.dataset.buy, el.checked);
    Maps.ownedChanged();
    persist();
    renderBasket();
    if (db.page === "map") Maps.render();
  }
});
dialog.addEventListener("close", () => {
  importSequence++;
});
window.handleBack = () => {
  if (typeof PointControls !== "undefined" && PointControls.isOpen()) {
    PointControls.close();
    return true;
  }
  if (dialog.open) {
    close();
    return true;
  }
  if (db?.detail) {
    move(db.page);
    return true;
  }
  if (db && db.page !== "library") {
    move("library");
    return true;
  }
  return false;
};
async function start() {
  try {
    const response = await fetch("catalogue.json");
    if (!response.ok) throw Error("资料加载失败");
    catalogue = await response.json();
    const packed = await fetch("bundled-guides.json");
    if (!packed.ok) throw Error("内置攻略加载失败");
    bundled = await packed.json();
    const saved = localStorage.getItem(key);
    db = saved ? JSON.parse(saved) : fresh();
    if (!db.stageRangesMigrated) {
      for (const t of db.teams) {
        const template = GuideModel.offline.find((g) => g.title === t.title);
        if (
          template &&
          !t.source &&
          t.stages.every((s) => !s.start && !s.end) &&
          t.stages.map((s) => s.label).join("/") ===
            template.stages.map((s) => s.label).join("/")
        )
          t.stages.forEach((s) =>
            Object.assign(s, GuideModel.defaultRange(s.label)),
          );
      }
      db.stageRangesMigrated = true;
      persist();
    }
    if (!db.round16Migrated) {
      for (const t of db.teams)
        for (const s of t.stages) {
          if (s.start > GuideModel.maxRound) {
            s.start = s.end = null;
          } else if (s.end > GuideModel.maxRound) s.end = GuideModel.maxRound;
          else if (
            s.end === 15 &&
            s.isFinal &&
            (s.rangeSource === "默认参考" || t.conditions)
          )
            s.end = GuideModel.maxRound;
        }
      db.round16Migrated = true;
      persist();
    }
    await Workbench.initialize();
    if (db.page === "run") {
      db.page = "map";
      db.prefs.mapRunOpen = true;
      if (db.board) db.board.tab = "board";
      persist();
    }
    Maps.restoreRosterSource();
    render();
  } catch (e) {
    desk.innerHTML = `<h2>手册暂时无法打开</h2><p>${esc(e.message)}</p>`;
  }
}
start();
