"use strict";
const Workbench = (() => {
  const files = [
    "operators",
    "custom_operators",
    "ban_index",
    "multiplayer_bans",
    "multiplayer_thresholds",
    "operator_profiles",
    "custom_operator_profiles",
    "covenants",
    "covenant_icons",
    "economy",
    "covenant_effects",
    "equipment",
    "garrison_maps",
    "strategies",
    "bosses",
    "enemy_types",
  ];
  const data = {},
    profiles = {},
    rawOps = {},
    equipmentChanges = {};
  const pages = ["atlas", "planner", "map", "run", "prefs"];
  let selection,
    atlasKind = "op",
    atlasFilters = {};
  const defaults = () => ({
    banned: [],
    bannedBonds: [],
    round: 1,
    terminal: 1,
    money: null,
    upgrade: null,
    mode: "mode_multi_funny",
    boss: "",
    enemyTypes: [],
    elite: {},
    counts: {},
    picked: [],
  });
  async function initialize() {
    void engine("warmup", {}).catch(() => {});
    await Promise.all(
      files.map(async (name) => {
        const r = await fetch("rules/" + name + ".json");
        if (!r.ok) throw Error("无法读取 " + name);
        data[name] = await r.json();
      }),
    );
    for (const n of ["operators", "custom_operators"])
      for (const op of data[n].operators) rawOps[op.name] = op;
    for (const item of data.equipment.equipment) {
      const named = data.covenants.covenants.find(c => c.name && item.name.includes(c.name));
      if (named || data.equipment.manualJobChangeEquipments.includes(item.name))
        equipmentChanges[item.name] = data.covenants.jobChangeEquipmentToCovenant[item.name] || named?.name || "";
    }
    Object.assign(
      profiles,
      data.operator_profiles.operators,
      data.custom_operator_profiles.operators,
    );
    const savedRun = db.run || {};
    const selected = Array.isArray(savedRun.enemyTypes) ? savedRun.enemyTypes : [savedRun.enemy];
    db.run = Object.assign(defaults(), savedRun, {
      money: Economy.balance(savedRun.money),
      enemyTypes: Object.keys(data.enemy_types.types).filter(code => selected.includes(code)),
    });
    delete db.run.enemy;
    if (savedRun.money !== db.run.money || Object.hasOwn(savedRun, "enemy") ||
        JSON.stringify(savedRun.enemyTypes) !== JSON.stringify(db.run.enemyTypes)) persist();
    db.run.round = Math.max(
      1,
      Math.min(GuideModel.maxRound, Number(db.run.round) || 1),
    );
    db.prefs = Object.assign(
      {
        dark: false,
        skin: "closure",
        multi: false,
        allStages: false,
        autoStage: false,
        zoom: 100,
        custom: [],
        tracked: [],
      },
      db.prefs,
    );
    applyTheme();
  }
  function applyTheme() {
    document.documentElement.dataset.dark = db.prefs.dark ? "1" : "0";
    document.documentElement.dataset.skin = db.prefs.skin;
    document.body.style.zoom = String(db.prefs.zoom / 100);
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue("--title-bg")
      .trim()
      .slice(0, 7);
    if (window.Tablet?.chromeColor && /^#[0-9a-f]{6}$/i.test(color))
      Tablet.chromeColor(color);
  }
  function engineWorker() {
    let worker, seq = 0;
    const pending = new Map();
    function stop(message = "已取消计算") {
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error(message));
      }
      pending.clear();
    }
    function watchdog(p) {
      clearTimeout(p.timer);
      if (p.timed) p.timer = setTimeout(() => stop("计算引擎未响应，请重新点选站位。"), 60000);
    }
    function run(action, req, progress) {
      if (!worker) {
        const active = new Worker("solver.js", { type: "module" });
        worker = active;
        active.onmessage = ({ data: m }) => {
          const p = pending.get(m.id);
          if (!p || active !== worker) return;
          if (m.progress) {
            watchdog(p);
            p.progress?.(...m.progress);
            return;
          }
          clearTimeout(p.timer);
          pending.delete(m.id);
          m.error ? p.reject(Error(m.error)) : p.resolve(m.value);
        };
        active.onerror = active.onmessageerror = () => {
          if (active === worker) stop("规划引擎加载失败，请重试。");
        };
      }
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const p = { resolve, reject, progress, timed: ["placement", "evaluate", "warmup"].includes(action) };
        pending.set(id, p);
        watchdog(p);
        worker.postMessage({ id, action, req });
      });
    }
    return { run, stop };
  }
  const plannerWorker = engineWorker(), mapWorker = engineWorker();
  function engine(action, req, progress) {
    const target = ["placement", "evaluate", "warmup"].includes(action) ? mapWorker : plannerWorker;
    return target.run(action, req, progress);
  }
  function request() {
    return {
      banned: db.run.banned,
      bannedBonds: effectiveBonds(),
      custom: db.prefs.custom,
      terminal: db.run.terminal,
      round: db.run.round,
      money: db.run.money,
      upgrade: Economy.price(db.run, data.economy),
      owned: Object.keys(db.run.counts).filter((k) => db.run.counts[k] > 0),
    };
  }
  function isBanned(name) {
    const op = rawOps[name];
    if (!op) return false;
    return (
      db.run.banned.includes(name) ||
      bannedByBonds(name, db.run.bannedBonds)
    );
  }
  function fixedBonds() { return data.multiplayer_bans[db.run.mode]?.inactive || []; }
  function effectiveBonds() { return [...new Set([...fixedBonds(), ...db.run.bannedBonds])]; }
  function bannedByBonds(name, selected) {
    const fixed = fixedBonds();
    if (!selected.length && !fixed.length) return false;
    const rule = data.ban_index[name];
    const mask = rule.bonds.reduce((bits, bond, i) => (selected.includes(bond) || fixed.includes(bond)) ? bits | (1 << i) : bits, 0);
    return rule.excluded[mask];
  }
  function coreBanned(bond) {
    return effectiveBonds().includes(bond) && data.covenants.covenants.some(b => b.name === bond && b.bondType === "SEASON");
  }
  function availableHolders(bond) {
    return Object.values(rawOps).filter(op => !op.requiredStrategyId &&
      (!op.isCustom || db.prefs.custom.includes(op.name)) && !isBanned(op.name) &&
      (op.coreCovenants.includes(bond) || op.additionalCovenants.includes(bond))).length;
  }
  function banBondsDialog() {
    const mode = data.multiplayer_bans[db.run.mode], fixed = fixedBonds();
    const group = (core, label) => `<fieldset class="training-enemies"><legend>${label}</legend><div>${data.covenants.covenants
      .filter(b => (b.bondType === "SEASON") === core && !fixed.includes(b.name))
      .map(b => `<label><input type="checkbox" name="ban-covenant" value="${esc(b.name)}" ${db.run.bannedBonds.includes(b.name) ? "checked" : ""}>${data.covenant_icons[b.name] ? `<img class="ban-icon" alt="" src="${esc(data.covenant_icons[b.name])}">` : ""}${esc(b.name)}</label>`).join("")}</div></fieldset>`;
    popup(`<h2>本局置灰盟约</h2><p class="hint">${mode ? esc(mode.name)+" · 本局随机置灰 "+mode.core+" 核心、"+mode.additional+" 附加。" : ""}对照游戏「本局信息」勾选灰色图标。三个阶段共用。干员有核心盟约时看核心，无核心时看附加；对应组全部置灰才会禁用该干员。</p>
      ${fixed.length ? `<p class="hint">模式固定关闭 · ${esc(fixed.join("、"))}</p>` : ""}${group(true,"核心盟约")}${group(false,"附加盟约")}
      <details><summary id="ban-rule-total"></summary><p id="ban-rule-names"></p></details>
      <div class="actions">${act("ban-bonds-save","应用本局禁用","btn gold")}${button("cancel","取消","btn light")}</div>`);
    previewBans();
  }
  function selectedBans() {
    return [...body.querySelectorAll('[name="ban-covenant"]:checked')].map(el=>el.value);
  }
  function previewBans() {
    const selected = selectedBans();
    const names = Object.keys(rawOps).filter(name=>bannedByBonds(name, selected));
    $("ban-rule-total").textContent = "按盟约禁用 " + names.length + " 名干员";
    $("ban-rule-names").textContent = names.join("、") || "无";
  }
  function act(name, label, cls = "btn light", v = "") {
    return `<button type="button" class="${cls}" data-w="${esc(name)}" data-v="${esc(v)}">${esc(label)}</button>`;
  }
  function select(id, items, value) {
    return `<select id="${esc(id)}" class="compact-select">${items
      .map((item) => {
        const [v, t] = Array.isArray(item) ? item : [item, item];
        return `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(t)}</option>`;
      })
      .join("")}</select>`;
  }
  function control(name, content) {
    return `<label class="field"><span>${esc(name)}</span>${content}</label>`;
  }
  function picker(title, options, selected, save, max = 0) {
    selection = {
      options: options.map((o) =>
        typeof o === "string" ? { id: o, name: o } : o,
      ),
      values: new Set(selected),
      equipment: options.length > 0 && options.every(o => o.key?.startsWith("eq:")),
      operators:
        options.length > 0 &&
        options.every(
          (o) =>
            typeof o === "object" && o.key?.startsWith("op:") && rawOps[o.name],
        ),
      filters: {
        tier: new Set(),
        job: new Set(),
        bond: new Set(),
        scope: new Set(),
      },
      save,
      max,
    };
    popup(
      `<h2>${esc(title)}</h2><div id="selection-facets"></div><input id="wb-search" class="search" type="search" placeholder="按名称定位"><div class="pickgrid" id="wb-options"></div><div class="actions">${act("selection-save", "应用选择", "btn gold")}${selection.operators ? act("selection-batch", "勾选筛选结果") + act("selection-unfilter", "重置筛选", "linkbtn") : ""}${act("selection-clear", "清空选择", "linkbtn")}<span id="wb-count" class="hint"></span></div>`,
    );
    fillOptions();
  }
  function fillOptions() {
    const q = $("wb-search").value.trim().toLowerCase(),
      f = selection.filters;
    const activeNames = new Set(
      active()?.stages.flatMap((s) => s.entries.map((z) => z.key)) || [],
    );
    const facets = (label, key, values) =>
      `<div class="facet-row"><b>${esc(label)}</b><div>${values.map((v) => `<button data-w="selection-facet" data-v="${esc(key + "/" + v)}" aria-pressed="${f[key].has(v)}">${esc(v)}</button>`).join("")}</div></div>`;
    if (selection.operators) {
      const bonds = data.covenants.covenants;
      $("selection-facets").innerHTML =
        facets("等阶", "tier", ["1阶", "2阶", "3阶", "4阶", "5阶", "6阶"]) +
        facets("职业", "job", [
          "先锋",
          "近卫",
          "重装",
          "狙击",
          "术师",
          "医疗",
          "辅助",
          "特种",
        ]) +
        `<details id="selection-bond-panel" ${selection.bondsOpen ? "open" : ""}><summary>盟约筛选${f.bond.size ? " · " + [...f.bond].map(esc).join("、") : ""}</summary>` +
        facets(
          "核心",
          "bond",
          bonds.filter((c) => c.bondType === "SEASON").map((c) => c.name),
        ) +
        facets(
          "附加",
          "bond",
          bonds.filter((c) => c.bondType !== "SEASON").map((c) => c.name),
        ) +
        "</details>" +
        facets("范围", "scope", ["当前阵容", "已选", "本局可用"]);
    }
    if (selection.equipment)
      $("selection-facets").innerHTML = facets("等阶", "tier", equipmentTiers().map(n => n + "阶"));
    const filtered = selection.options.filter((o) => {
      const op = selection.operators ? rawOps[o.name] : null,
        tags = op ? [...op.coreCovenants, ...op.additionalCovenants] : [];
      const has = (k, value) => !f[k].size || f[k].has(value);
      if (selection.equipment && !has("tier", info(o.key).tier + "阶")) return false;
      if (
        op &&
        (!has("tier", op.tier + "阶") ||
          !has("job", profiles[o.name]?.profession) ||
          (f.bond.size && !tags.some((n) => f.bond.has(n))) ||
          (f.scope.has("当前阵容") && !activeNames.has(o.key)) ||
          (f.scope.has("已选") && !selection.values.has(o.id)) ||
          (f.scope.has("本局可用") &&
            (isBanned(o.name) ||
              (op.isCustom && !db.prefs.custom.includes(o.name)))))
      )
        return false;
      return [o.name, o.hint, o.initials, ...tags]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    if (selection.operators)
      filtered.sort(
        (a, b) =>
          rawOps[a.name].tier - rawOps[b.name].tier ||
          a.name.localeCompare(b.name, "zh-CN"),
      );
    selection.visible = filtered;
    const option = o => `<button class="pickitem ${selection.values.has(o.id) ? "chosen" : ""}" aria-pressed="${selection.values.has(o.id)}" data-w="selection-toggle" data-v="${esc(o.id)}">${o.key ? portrait(o.key) : ""}<div><strong>${esc(o.name)}</strong><small>${esc(o.hint || "")}</small></div><b>${selection.values.has(o.id) ? "✓" : "＋"}</b></button>`;
    $("wb-options").innerHTML = (selection.equipment ? equipmentGroups(filtered, o => o.key, option)
      : filtered.map(option).join("")) || "<p>没有匹配项</p>";
    $("wb-count").textContent =
      `当前 ${filtered.length} 项 · 已选 ${selection.values.size}${selection.max ? " / " + selection.max : ""}`;
  }
  function opChoices(names = Object.keys(rawOps)) {
    return names.map((id) => ({
      id,
      name: id,
      key: "op:" + id,
      initials: info("op:" + id).initials,
      hint:
        (rawOps[id]?.tier || "") + " 阶 · " + (profiles[id]?.profession || ""),
    }));
  }
  function toggleList(a, v) {
    return a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
  }
  function head(title, desc = "") {
    return `<h1>${esc(title)}</h1>${desc ? `<p class="sub">${esc(desc)}</p>` : ""}`;
  }
  function renderPage() {
    if (!db || !pages.includes(db.page)) return false;
    if (db.page === "atlas") atlas();
    if (db.page === "map") Maps.render();
    if (db.page === "planner") Planning.render();

    if (db.page === "prefs") prefs();
    return true;
  }
  function filterState() {
    return (atlasFilters[atlasKind] ||= {
      q: "",
      tiers: [],
      cores: [],
      extras: [],
      trait: "",
      trigger: "",
      category: "",
      type: "",
      matchAll: false,
      only: false,
    });
  }
  function atlas() {
    const f = filterState(),
      op = atlasKind === "op",
      all = data.covenants.covenants;
    const tab = (k, label) =>
      act("atlas-type", label, k === atlasKind ? "chosen" : "", k);
    const traits = [
      ...new Set(
        Object.values(rawOps).flatMap((o) =>
          o.normal.traits.map((t) => t.traitType),
        ),
      ),
    ].sort();
    const triggers = [
      ...new Set(
        Object.values(rawOps).flatMap((o) =>
          o.normal.traits.flatMap((t) =>
            Array.from(
              t.traitDescription.matchAll(/<([^@<>][^<>]{0,18})>/g),
              (m) => m[1],
            ),
          ),
        ),
      ),
    ].sort();
    const categories = [
      ...new Set(
        Object.values(catalogue)
          .filter((i) => i.kind === "eq")
          .flatMap((i) => i.tags),
      ),
    ];
    desk.innerHTML =
      head("图鉴") +
      `<div class="segments controls">${tab("op", "干员")}${tab("eq", "装备")}${tab("bond", "盟约")}${tab("strategy", "策略")}</div><input id="atlas-q" class="search" type="search" value="${esc(f.q)}" placeholder="搜索名称、拼音或关键词">
      ${
        ["op", "eq"].includes(atlasKind)
          ? `<div class="actions">${op ? act("atlas-tiers", "等阶：" + (f.tiers.join(" / ") || "全部")) + act("atlas-core", "核心盟约：" + (f.cores.join(" / ") || "全部")) + act("atlas-extra", "附加盟约：" + (f.extras.join(" / ") || "全部")) : equipmentTierButtons(f.tiers, "data-w=\"atlas-eq-tier\"")}${act("atlas-reset", "重置", "linkbtn")}</div>
      <div class="filtergrid">${
        op
          ? control("词条", select("atlas-trait", ["", ...traits], f.trait)) +
            control(
              "触发时机",
              select("atlas-trigger", ["", ...triggers], f.trigger),
            )
          : control(
              "功能",
              select("atlas-category", [["", "全部功能"], ...categories], f.category),
            ) +
            control(
              "类型",
              select("atlas-item-type", [["", "全部类型"], "普通", "转职"], f.type),
            )
      }</div>
      ${op ? `<div class="actions"><label><input id="atlas-only" type="checkbox" ${f.only ? "checked" : ""}> 只看本局可用</label><label><input id="atlas-match" type="checkbox" ${f.matchAll ? "checked" : ""}> 满足全部选中盟约</label></div>` : ""}`
          : ""
      }
      <div id="atlas-results"></div>`;
    atlasResults();
  }
  function atlasResults() {
    const f = filterState(),
      q = f.q.trim().toLowerCase();
    if (atlasKind === "bond" || atlasKind === "strategy") {
      const rows =
        atlasKind === "bond"
          ? data.covenants.covenants.map((c) => [
              c.name,
              c.bondType === "SEASON" ? "核心盟约" : "附加盟约",
            ])
          : data.strategies.strategies.map((s) => [s.name, s.initiator]);
      $("atlas-results").innerHTML = `<div class="unitgrid controls">${rows
        .filter((r) => r.join(" ").toLowerCase().includes(q))
        .map(([n, sub]) => act("reference", n + " · " + sub, "chip", n))
        .join("")}</div>`;
      return;
    }
    const group = (have, need) =>
      !need.length ||
      (f.matchAll
        ? need.every((s) => have.includes(s))
        : need.some((s) => have.includes(s)));
    const rows = Object.entries(catalogue)
      .filter(([k, t]) => {
        if (
          t.kind !== atlasKind ||
          ![t.name, t.initials, ...t.tags, ...(t.kind === "eq" ? [t.normal, t.elite, equipmentChanges[t.name]] : [])]
            .join(" ")
            .toLowerCase()
            .includes(q) ||
          (f.tiers.length && !f.tiers.includes(String(t.tier)))
        )
          return false;
        if (atlasKind === "eq") {
          const change = Object.hasOwn(equipmentChanges, t.name);
          return (
            (!f.category || t.tags.includes(f.category)) &&
            (!f.type || (f.type === "转职") === change)
          );
        }
        const o = rawOps[t.name];
        return (
          (!f.only ||
            (!isBanned(t.name) &&
              (!t.custom || db.prefs.custom.includes(t.name)))) &&
          group(o.coreCovenants, f.cores) &&
          group(o.additionalCovenants, f.extras) &&
          (!f.trait || o.normal.traits.some((x) => x.traitType === f.trait)) &&
          (!f.trigger ||
            o.normal.traits.some((x) =>
              x.traitDescription.includes("<" + f.trigger + ">"),
            ))
        );
      })
      .sort((a, b) => a[1].tier - b[1].tier);
    if (atlasKind === "eq") {
      const card = ([key, item]) => `<button type="button" class="equipment-card" data-w="atlas-item" data-v="${esc(key)}"><span class="equipment-head">${portrait(key)}<span><strong>${esc(item.name)}</strong><small>${identity([...item.tags, equipmentChanges[item.name] && "转职 · " + equipmentChanges[item.name]])}</small></span></span>${equipmentEffects(item)}</button>`;
      $("atlas-results").innerHTML = section(`${rows.length} 件装备`) +
        (rows.length ? `<div class="equipment-grid">${equipmentGroups(rows, row => row[0], card)}</div>` : '<p class="hint">没有符合筛选的装备</p>');
      return;
    }
    $("atlas-results").innerHTML =
      section(`${rows.length} 项`) +
      `<div class="unitgrid">${rows.map(([k, t]) => `<button class="unit" data-w="atlas-item" data-v="${esc(k)}">${portrait(k)}${facts({ key: k })}</button>`).join("")}</div>`;
  }
  function atlasItem(k) {
    showItem(k);
    const t = info(k),
      p = profiles[t.name];
    if (p)
      body.insertAdjacentHTML(
        "beforeend",
        `<p class="hint">${identity([p.profession, p.subProfession, p.position, "阻挡 " + p.blockCount])}</p>${p.eliteSkill ? section("精锐技能 · " + p.eliteSkill.name) + `<p>${esc(p.eliteSkill.description)}</p>` : ""}`,
      );
    body.insertAdjacentHTML(
      "beforeend",
      `<div class="actions">${act("atlas-track", "加入当前阶段清单", "btn gold", k)}${t.kind === "op" ? act("atlas-ban", db.run.banned.includes(t.name) ? "解除本局禁用" : "本局禁用", "btn light", k) : ""}</div>`,
    );
  }
  function prefs() {
    const p = db.prefs;
    desk.innerHTML =
      head("设置") +
      section("外观") +
      `<div class="filtergrid">${control(
        "主题",
        select(
          "pref-skin",
          [
            ["terminal", "终端"],
            ["ursus", "乌萨斯齐心团"],
            ["closure", "可露希尔"],
          ],
          p.skin,
        ),
      )}${control(
        "文字与界面缩放",
        select(
          "pref-zoom",
          [85, 90, 100, 110, 120, 130].map((n) => [n, n + "%"]),
          p.zoom,
        ),
      )}</div>
      <label class="checkline"><input type="checkbox" id="pref-dark" ${p.dark ? "checked" : ""}> 深色模式</label>${section("追踪")}
      ${[
        ["multi", "同时追踪多个阵容"],
        ["allStages", "查看全程需求"],
        ["autoStage", "按手动录入的回合切换阶段"],
      ]
        .map(
          ([v, n]) =>
            `<label class="checkline"><input type="checkbox" id="pref-${v}" ${p[v] ? "checked" : ""}> ${n}</label>`,
        )
        .join("")}
      <div class="actions">${act("multi-choose", "选择追踪阵容")}${act("custom", "自选干员（" + p.custom.length + "）")}</div>
      ${section("移植版")}<div class="actions">${button("about", "版本与来源")}${act("updates", "查看 GitHub 发布版")}${act("backup", "备份 / 恢复本机数据")}</div>`;
  }
  function trainingEnemyDetails() {
    return db.run.enemyTypes.map(code => {
      const type = data.enemy_types.types[code];
      return `<article class="note" data-enemy-detail="${esc(code)}"><strong>${esc(type.typeName)}</strong>
        <p>前半程 · ${esc(type.firstHalfVariants.map(e => e.enemyName).join("、"))}</p>
        <p>后半程 · ${esc(type.secondHalfVariants.map(e => e.enemyName).join("、"))}</p></article>`;
    }).join("");
  }
  function setRound(value) {
    if (!Number.isInteger(value) || value<1 || value>GuideModel.maxRound || value===db.run.round) return;
    db.run.round=value;
    Economy.changed(db.run,"round");
    if (db.prefs.autoStage) Teams.roundChanged();
    persist();
    render();
  }
  function advanceButton(cls="linkbtn") {
    return db.run.round<GuideModel.maxRound ? act("map-next-round","下一回合",cls,db.run.round+1) : "";
  }
  function runPanel() {
    const r = db.run,
      boss = data.bosses.bosses.find((b) => b.name === r.boss),
      hp = boss?.hp.find((h) => h.mode === r.mode);
    const modes = db.page==="planner" && db.planning?.kind==="auto" ? [...(!data.multiplayer_bans[r.mode] ? [["","选择多人难度"]] : []), ...Object.entries(data.multiplayer_bans).map(([id,m])=>[id,m.name])] : [
      ["mode_training_2", "入门协议"],
      ...data.bosses.bosses[0].hp.map((h) => [h.mode, h.name]),
    ];
    return section("回合与商店") +
      `<div class="filtergrid">
      ${[
        ["round", "回合", 1, GuideModel.maxRound],
        ["terminal", "终端等级", 1, 6],
      ]
        .map(([k, n, min, max]) =>
          control(
            n,
            select("run-"+k,Array.from({length:max-min+1},(_,i)=>[min+i,k==="round"?"第 "+(min+i)+" 回合":(min+i)+" 本"]),r[k]),
          ),
        )
        .join("")}</div>
      ${Economy.view(r, data.economy, Workbench)}${section("本局禁用")}<div class="actions">${act("ban-bonds", "禁用盟约 · " + effectiveBonds().length)}${act("ban-ops", "额外禁用干员 · " + r.banned.length)}</div><div class="tags controls">${[...effectiveBonds(), ...r.banned].map(tag).join("")}</div>
      ${section("敌方领袖与特训敌人")}<div class="filtergrid">${control("模式 / 规程等级", select("run-mode", modes, r.mode))}${control("敌方领袖", select("run-boss", [["", "未选择"], ...data.bosses.bosses.map((b) => b.name)], r.boss))}</div>
      <fieldset class="training-enemies"><legend>特训敌人（可多选）</legend>
        <div>${Object.entries(data.enemy_types.types).map(([code, type]) => `<label><input type="checkbox" name="training-enemy" value="${esc(code)}"${r.enemyTypes.includes(code) ? " checked" : ""}>${esc(type.typeName)}</label>`).join("")}</div>
      </fieldset><div id="training-enemy-details">${trainingEnemyDetails()}</div>
      ${boss ? `<article class="note"><strong>${esc(boss.name)}</strong><p>${esc(boss.description)}</p>${hp ? `<h4>${esc(hp.name)} · 生命 ${Number(hp.hp).toLocaleString()}${hp.hiddenHp ? " · 隐藏形态 " + Number(hp.hiddenHp).toLocaleString() : ""}</h4>` : ""}<ul>${boss.abilityList.map((v) => `<li>${esc(v.replace(/<[^>]+>/g, ""))}</li>`).join("")}</ul><details><summary>各难度生命值</summary>${boss.hp.map((h) => `<p>${esc(h.name)}　${h.hp.toLocaleString()}${h.hiddenHp ? " / " + h.hiddenHp.toLocaleString() : ""}</p>`).join("")}</details></article>` : ""}
      <div class="actions">${act("new-run", "开始新局", "btn light danger")}</div>`;
  }
  function ownedDialog() {
    QuickRoster.open({title:"快调本局干员", pool:QuickRoster.owned(), names:Object.keys(rawOps).filter(n=>!isBanned(n)), addBought:true,
      apply(pool) {
        QuickRoster.setOwned(pool);
        Maps.ownedChanged();
        persist();
        render();
      }
    });
  }
  async function click(a, v) {
    if (a === "run") {
      db.prefs.mapRunOpen = true;
      if (db.board) db.board.tab = "board";
      move("map");
      return;
    }
    if (pages.includes(a)) {
      if (a === "map" && db.board) db.board.tab = "board";
      move(a);
      if (a === "map") Maps.showInitial();
      return;
    }
    const f = filterState(),
      p = db.prefs,
      r = db.run;
    if (a==="map-next-round") {setRound(Number(v));return;}
    if (a==="next-retry") return NextStep.retry();
    if (a.startsWith("income-")) { ItemIncome.click(a,v); return; }
    if (a === "selection-facet") {
      selection.bondsOpen = $("selection-bond-panel")?.open;
      const [key, value] = v.split("/");
      const set = selection.filters[key];
      if (set.has(value)) set.delete(value);
      else set.add(value);
      fillOptions();
      return;
    }
    if (a === "selection-batch") {
      const unique = new Set([
        ...selection.values,
        ...selection.visible.map((o) => o.id),
      ]);
      if (selection.max && unique.size > selection.max) {
        toast("当前结果超过 " + selection.max + " 项，请继续筛选");
        return;
      }
      selection.values = unique;
      fillOptions();
      return;
    }
    if (a === "selection-unfilter") {
      for (const set of Object.values(selection.filters)) set.clear();
      $("wb-search").value = "";
      fillOptions();
      return;
    }
    if (a === "selection-toggle") {
      if (
        selection.max &&
        !selection.values.has(v) &&
        selection.values.size >= selection.max
      ) {
        toast("最多选择 " + selection.max + " 项");
        return;
      }
      if (selection.values.has(v)) selection.values.delete(v);
      else selection.values.add(v);
      fillOptions();
      return;
    }
    if (a === "selection-clear") {
      selection.values.clear();
      fillOptions();
      return;
    }
    if (a === "selection-save") {
      const fn = selection.save,
        values = [...selection.values];
      close();
      await fn(values);
      return;
    }
    if (a === "atlas-type") {
      atlasKind = v;
      atlas();
      return;
    }
    if (a === "atlas-eq-tier") {
      const f = filterState();
      f.tiers = v ? toggleList(f.tiers, v) : [];
      atlas();
      return;
    }
    if (a === "atlas-reset") {
      delete atlasFilters[atlasKind];
      atlas();
      return;
    }
    if (
      a.startsWith("atlas-") &&
      ["tiers", "core", "extra"].includes(a.slice(6))
    ) {
      const k = { tiers: "tiers", core: "cores", extra: "extras" }[a.slice(6)];
      picker(
        "选择筛选条件",
        k === "tiers"
          ? ["1", "2", "3", "4", "5", "6"]
          : data.covenants.covenants
              .filter((c) => (c.bondType === "SEASON") === (k === "cores"))
              .map((c) => c.name),
        f[k],
        (vals) => {
          f[k] = vals;
          atlas();
        },
      );
      return;
    }
    if (a === "atlas-item") {
      atlasItem(v);
      return;
    }
    if (a === "atlas-track") {
      let t = active();
      if (!t)
        t = incorporate({
          title: "手动追踪",
          stages: [{ label: "当前清单", entries: [], note: "" }],
        });
      const stage = t.stages[stageNum(t)];
      if (!stage.entries.some((e) => e.key === v))
        stage.entries.push({ key: v });
      persist();
      close();
      render();
      toast("已加入清单");
      return;
    }
    if (a === "atlas-ban") {
      r.banned = toggleList(r.banned, info(v).name);
      Maps.bansChanged();
      persist();
      close();
      render();
      return;
    }
    if (a === "reference") {
      const ref = data.strategies.strategies.find((s) => s.name === v);
      popup(
        `<h2>${esc(v)}</h2>${ref ? `<p>${esc(ref.initiator)} · 初始生命 ${ref.initialHp}</p><div class="note">${esc(ref.description)}</div><p>${esc(ref.unlockRequirement)}</p>` : (data.covenant_effects.covenants[v] || []).map((x) => `<div class="note"><strong>${esc(x.condition)}</strong><p>${esc(x.text)}</p></div>`).join("")}`,
      );
      return;
    }
    if (a === "ban-bonds") { banBondsDialog(); return; }
    if (a === "ban-bonds-save") {
      r.bannedBonds = selectedBans();
      Maps.bansChanged();
      persist();
      close();
      render();
      return;
    }
    if (
      a === "ban-ops" ||
      a === "custom" ||
      a === "multi-choose"
    ) {
      const opts =
        a === "multi-choose"
            ? db.teams.map((t) => ({ id: t.id, name: t.title }))
            : opChoices(
                a === "custom"
                  ? Object.keys(rawOps).filter((n) => rawOps[n].isCustom)
                  : undefined,
              );
      const obj = a.startsWith("ban") ? r : p,
        k = {
          "ban-ops": "banned",
          custom: "custom",
          "multi-choose": "tracked",
        }[a];
      picker(
        "选择" +
          {
            banned: "禁用干员",
            custom: "自选干员",
            tracked: "追踪阵容",
          }[k],
        opts,
        obj[k],
        (vals) => {
          obj[k] = vals;
          if (a === "ban-ops") Maps.bansChanged();
          persist();
          render();
        },
      );
      return;
    }
    if (a === "owned") {
      ownedDialog();
      return;
    }
    if (a === "new-run") {
      popup(
        `<h2>开始新局？</h2><p>重置本局禁用、商店数值、购买进度和部署。阵容与攻略会保留。</p>${act("new-run-yes", "开始新局", "btn gold")}`,
      );
      return;
    }
    if (a === "new-run-yes") {
      db.run = defaults();
      delete db.board;
      for (const t of db.teams) {
        t.owned = [];
        t.stage = 0;
      }
      persist();
      close();
      render();
      return;
    }
    if (a === "updates") {
      location.href =
        "https://github.com/Johnnylov/hongxue-stronghold-companion-android/releases";
      return;
    }
    if (a === "backup") {
      Teams.backup();
      return;
    }
    if (a.startsWith("map-")) return Maps.click(a, v);
    if (a.startsWith("workshop-")) return Workshop.click(a.slice(9),v);
    if (a.startsWith("plan-")) return Planning.click(a, v);
    if (a.startsWith("team-")) return Teams.click(a, v);
  }
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-w],nav [data-act]");
    const a = el?.dataset.w || el?.dataset.act;
    if (db && a && (el.hasAttribute("data-w") || pages.includes(a)))
      Promise.resolve(click(a, el.dataset.v)).catch((e) => toast(e.message));
  });
  document.addEventListener("input", (ev) => {
    if (!db) return;
    const e = ev.target;
    if (e.id === "wb-search") fillOptions();
    if (e.id === "atlas-q") {
      filterState().q = e.value;
      atlasResults();
    }
  });
  document.addEventListener("change", (ev) => {
    if (!db) return;
    const e = ev.target,
      k = e.id.replace(/^.*?-/, "");
    if (e.name === "ban-covenant") { previewBans(); return; }
    if (e.name === "training-enemy") {
      db.run.enemyTypes = Array.from(desk.querySelectorAll('input[name="training-enemy"]:checked'), box => box.value);
      persist();
      $("training-enemy-details").innerHTML = trainingEnemyDetails();
      return;
    }
    if (e.id.startsWith("pref-")) {
      db.prefs[k] =
        e.type === "checkbox"
          ? e.checked
          : k === "zoom"
            ? Number(e.value)
            : e.value;
      applyTheme();
      persist();
      render();
    }
    if (e.id.startsWith("atlas-") && e.id !== "atlas-q") {
      const name =
        { only: "only", match: "matchAll", "item-type": "type" }[k] || k;
      filterState()[name] = e.type === "checkbox" ? e.checked : e.value;
      atlasResults();
    }
    if (e.id.startsWith("run-")) {
      const numeric=["round","terminal","upgrade","money","levelSince"].includes(k);
      const value=numeric ? (e.value==="" ? null : Number(e.value)) : e.value;
      if (k==="round") {setRound(value);return;}
      if (k==="money") ItemIncome.confirmBalance(db.run,value);
      else db.run[k]=value;
      Economy.changed(db.run, k);
      if (k === "mode") Maps.bansChanged();
      persist();
      render();
    }
  });
  return {
    initialize,
    renderPage,
    runPanel,
    advanceButton,
    data,
    profiles,
    rawOps,
    equipmentChanges,
    request,
    engine,
    stopEngine: plannerWorker.stop,
    stopMap: mapWorker.stop,
    engineWorker,
    act,
    select,
    control,
    picker,
    opChoices,
    isBanned,
    coreBanned,
    effectiveBonds,
    availableHolders,
    head,
    applyTheme,
    ownedDialog,
  };
})();
