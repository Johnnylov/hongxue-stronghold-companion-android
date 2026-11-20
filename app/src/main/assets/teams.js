"use strict";
const Teams = (() => {
  const W = Workbench,
    labels = ["叠层", "输出", "控场", "经济", "阵容核心"];
  let slotDraft,
    repair,
    filter = "",
    statusFilter = "",
    bondFilter = "",
    statuses = {};
  function finalIndex(t) {
    const i = t.stages.findIndex((s) => s.isFinal);
    if (i >= 0) return i;
    const found = t.stages.findIndex((s) => /成型|后期/.test(s.label));
    return found < 0 ? t.stages.length - 1 : found;
  }
  function rows(t, s) {
    const entries = s.entries.slice();
    for (const e of s.entries.filter((e) => e.key.startsWith("op:"))) {
      for (const gear of [
        ...(e.equipment || []),
        ...(e.candidates || []).map((c) => c.name),
      ])
        entries.push({
          key: "eq:" + gear,
          detail:
            info(e.key).name +
            (e.coreEquipment?.includes(gear) ? " · 核心" : ""),
        });
    }
    return GuideModel.shoppingRows({ entries });
  }
  function tracked() {
    const t = active();
    return !t
      ? []
      : db.prefs.multi
        ? [...new Set([t.id, ...db.prefs.tracked])]
            .map((id) => db.teams.find((g) => g.id === id))
            .filter(Boolean)
        : [t];
  }
  function basketRows() {
    const joined = new Map();
    for (const t of tracked()) {
      const stages = db.prefs.allStages ? t.stages : [t.stages[stageNum(t)]];
      for (const s of stages)
        for (const row of rows(t, s)) {
          let entry = joined.get(row.token);
          if (!entry) {
            entry = { ...row, sources: new Set(), roles: new Set() };
            joined.set(row.token, entry);
          }
          entry.sources.add(t.title);
          if (row.key.startsWith("op:"))
            entry.roles.add(
              row.role ||
                (t.stages[finalIndex(t)].entries.some((e) => e.key === row.key)
                  ? "最终"
                  : "过渡"),
            );
        }
    }
    return [...joined.values()].map((e) => ({
      ...e,
      detail: [
        e.detail,
        ...e.roles,
        ...(db.prefs.multi && tracked().length > 1 ? e.sources : []),
      ]
        .filter(Boolean)
        .join(" · "),
    }));
  }
  function owned(token) {
    return tracked().some((t) => t.owned.includes(token));
  }
  function mark(token, on) {
    const [k, n] = JSON.parse(token);
    for (const t of tracked()) {
      const set = new Set(t.owned);
      if (on) set.add(token);
      else set.delete(token);
      t.owned = [...set];
    }
    if (k.startsWith("op:")) {
      const name = k.slice(3);
      const unit = {name,count:db.run.counts[name] || 0,elite:db.run.elite[name] || 0};
      if (on) QuickRoster.purchaseFloor(unit, n);
      else if (QuickRoster.rawCopies(unit) <= n) {
        const remaining = [...new Set(db.teams.flatMap((t) => t.owned))]
          .map((x) => JSON.parse(x))
          .filter(([key]) => key === k)
          .map((x) => x[1]);
        unit.count = Math.max(0, ...remaining);
        unit.elite = 0;
        QuickRoster.normalize(unit);
      }
      db.run.counts[name] = unit.count;
      db.run.elite[name] = unit.elite;
    }
  }
  function roundChanged() {
    for (const t of tracked()) {
      const i = t.stages.findIndex(
        (s) =>
          s.start &&
          db.run.round >= s.start &&
          db.run.round <= (s.end || s.start),
      );
      if (i >= 0) t.stage = i;
      else if (
        t.stages.some((s) => s.end) &&
        db.run.round > Math.max(...t.stages.map((s) => s.end || 0))
      )
        t.stage = finalIndex(t);
    }
  }
  function toSlot(e) {
    return {
      operatorName: info(e.key).name,
      isElite: !!e.elite,
      isReserve: !!e.reserve,
      guideLoadout: e.loadout || null,
      equipments: e.equipment || [],
      coreEquipments: e.coreEquipment || [],
      candidateEquipments: e.candidates || [],
      tags: (e.labels || [])
        .map((k) => labels.indexOf(k))
        .filter((i) => i >= 0),
    };
  }
  function toPC(t) {
    const fi = finalIndex(t),
      stages = t.stages.map((s, i) => ({
        id: i === fi ? "final" : "stage-" + i,
        name: s.label,
        isFinal: i === fi,
        startRound: s.start || null,
        endRound: s.end || null,
        operationIdea: s.note || "",
        activeCovenants: s.bonds || [],
        recommendedEquipments: s.entries
          .filter((e) => e.key.startsWith("eq:"))
          .map((e) => info(e.key).name),
        slots: s.entries.filter((e) => e.key.startsWith("op:")).map(toSlot),
      }));
    return {
      id: t.id,
      name: t.title,
      sourceUrl: t.source || null,
      slots: stages[fi].slots,
      earlySlots: stages[0].slots,
      midSlots: stages[1]?.slots || [],
      supportSlots: stages.find((s) => s.name === "挂件")?.slots || [],
      editorStages: stages,
      strategies: (t.strategyIds || []).map((strategyId) => ({ strategyId })),
      targetCovenants: Object.entries(t.goals || {}).map(([name, tier]) => ({
        name,
        tier,
      })),
      upgradeReminders: t.upgradeReminders || [],
      upgradeNotificationsEnabled: !!t.upgradeNotificationsEnabled,
    };
  }
  function safeSource(s) {
    try {
      GuideModel.guideId(s || "");
      return s;
    } catch {
      return "";
    }
  }
  function fromPC(raw) {
    if (
      !raw ||
      typeof raw.name !== "string" ||
      !raw.name.trim() ||
      !Array.isArray(raw.slots)
    )
      throw Error("不是可识别的阵容 JSON。");
    let stages = raw.sklandGuide?.stages || raw.editorStages;
    if (!stages?.length)
      stages = [
        ["前期", raw.earlySlots],
        ["中期", raw.midSlots],
        ["成型", raw.slots],
        ["挂件", raw.supportSlots],
      ]
        .filter(([n, slots]) => n === "成型" || slots?.length)
        .map(([name, slots]) => ({ name, slots, isFinal: name === "成型" }));
    if (stages.length > 48) throw Error("阶段太多，无法导入。");
    const result = {
      title: raw.name,
      source: safeSource(raw.sourceUrl),
      author: raw.sklandGuide?.author || "",
      goals: Object.fromEntries(
        (raw.targetCovenants || []).map((t) => [t.name, t.tier]),
      ),
      strategyIds: (raw.strategies || []).map((x) => x.strategyId),
      stages: stages.map((s) => {
        if (!Array.isArray(s.slots) || s.slots.length > 100)
          throw Error("阶段干员数据无效。");
        const entries = s.slots.map((o) => {
          if (!o.operatorName || typeof o.operatorName !== "string")
            throw Error("干员名称缺失。");
          return {
            key: "op:" + o.operatorName,
            elite: !!o.isElite,
            reserve: !!o.isReserve,
            equipment: o.equipments || [],
            coreEquipment: o.coreEquipments || [],
            candidates: o.candidateEquipments || [],
            labels: (o.tags || [])
              .map((i) => (typeof i === "number" ? labels[i] : i))
              .filter(Boolean),
            loadout: o.guideLoadout,
            detail: o.isElite ? "精锐" : "",
          };
        });
        for (const name of s.recommendedEquipments || [])
          if (typeof name === "string") entries.push({ key: "eq:" + name });
        return {
          label: String(s.name || "阶段"),
          start: Number.isInteger(s.startRound) ? s.startRound : null,
          end: Number.isInteger(s.endRound) ? s.endRound : null,
          isFinal: !!s.isFinal,
          note: s.operationIdea || "",
          bonds: s.activeCovenants || [],
          entries,
        };
      }),
      upgradeReminders: raw.upgradeReminders || [],
      upgradeNotificationsEnabled: !!raw.upgradeNotificationsEnabled,
    };
    return result;
  }
  function pane(t) {
    queueMicrotask(() => updateCounts(t));
    return (
      `<div class="actions controls">${W.act("team-workshop","阵容推演")}${W.act("team-layout", "阶段与回合")}${W.act("team-targets", "目标盟约")}${W.act("team-strategy", "策略")}${W.act("team-review", "本局推荐 / 修补")}${W.act("team-share", "分享阵容")}${W.act("team-reminders", "升本提醒")}${t.autoPlan ? W.act("team-advice", "查看自动路线") : ""}</div><div id="team-counts" class="hint"></div>` +
      (Object.keys(t.goals || {}).length || t.strategyIds?.length
        ? `<div class="tags">${Object.entries(t.goals || {})
            .map(([k, n]) => tag(k + (n === 2 ? " Ⅱ" : " Ⅰ")))
            .join(
              "",
            )}${(t.strategyIds || []).map((id) => tag(W.data.strategies.strategies.find((s) => s.id === id)?.name || id)).join("")}</div>`
        : "")
    );
  }
  function controls() {
    return `<div class="actions controls">${W.act("team-import", "导入阵容 JSON / 链接")}${W.act("team-search", "搜索与本局筛选")}</div>`;
  }
  function layout(t) {
    const fi = finalIndex(t);
    popup(
      `<h2>阶段与回合</h2><p class="hint">设定回合范围后，可在设置中开启按回合切换。</p><div class="listbox">${t.stages.map((s, i) => `<div class="listrow stage-edit"><strong>${esc(s.label)}${i === fi ? " · 成型" : ""}</strong><div>${W.act("team-range", s.start ? s.start + "–" + s.end + " 回合" : "设回合", "chip", i)}${W.act("team-stage-up", "↑", "chip", i)}${W.act("team-stage-down", "↓", "chip", i)}${W.act("team-stage-copy", "复制", "chip", i)}${W.act("team-stage-del", "删除", "chip", i)}</div></div>`).join("")}</div><div class="actions">${W.act("team-stage-add", "新增阶段")}${W.act("team-final", "设当前阶段为成型")}</div>`,
    );
  }
  function ranges(t, i) {
    const s = t.stages[i];
    popup(
      `<h2>${esc(s.label)}的回合范围</h2><div class="filtergrid">${W.control("开始回合", `<input id="range-a" type="number" min="1" max="${GuideModel.maxRound}" value="${esc(s.start || "")}">`)}${W.control("结束回合", `<input id="range-b" type="number" min="1" max="${GuideModel.maxRound}" value="${esc(s.end || "")}">`)}</div>${W.act("team-range-save", "保存范围", "btn gold", i)}`,
    );
  }
  function slotEditor(t, k, newDraft = true) {
    const s = t.stages[stageNum(t)],
      entry = s.entries.find((e) => e.key === k);
    if (!entry || !k.startsWith("op:")) {
      showItem(k);
      return;
    }
    if (newDraft) slotDraft = clone(entry);
    const e = slotDraft,
      skills = e.loadout?.skills || [],
      mods = e.loadout?.modules || [];
    popup(`<h2>${esc(info(k).name)}</h2><div class="actions"><label><input type="checkbox" id="slot-elite" ${e.elite ? "checked" : ""}> 精锐</label><label><input type="checkbox" id="slot-reserve" ${e.reserve ? "checked" : ""}> 备选干员</label></div>
      ${section("角色标签")}<div class="segments">${labels.map((l) => W.act("team-slot-label", l, e.labels?.includes(l) ? "chosen" : "", l)).join("")}</div>
      ${section("装备")}<div class="actions">${W.act("team-slot-gear", "配置装备")}${W.act("team-slot-core", "核心装备")}${W.act("team-slot-candidate", "候选装备")}${W.act("team-slot-priority", "优先候选")}</div><p class="sub">${esc([...(e.equipment || []), ...(e.candidates || []).map((c) => c.name + (c.isPriority ? "（优先）" : "（候选）"))].join("、") || "暂无配置")}</p>
      ${
        skills.length
          ? W.control(
              "技能",
              W.select(
                "slot-skill",
                skills.map((x) => [x.id, x.name]),
                e.loadout.skillId,
              ),
            )
          : ""
      }${
        mods.length
          ? W.control(
              "模组",
              W.select(
                "slot-mod",
                mods.map((x) => [x.id, x.name]),
                e.loadout.moduleId,
              ),
            )
          : ""
      }
      <div class="actions controls">${W.act("team-slot-save", "保存干员", "btn gold")}${W.act("team-slot-copy", "复制到其他阶段")}${W.act("team-slot-info", "查看图鉴")}</div>`);
  }
  function slotForm() {
    if (!$("slot-elite")) return;
    slotDraft.elite = $("slot-elite").checked;
    slotDraft.reserve = $("slot-reserve").checked;
    if ($("slot-skill")) slotDraft.loadout.skillId = $("slot-skill").value;
    if ($("slot-mod")) slotDraft.loadout.moduleId = $("slot-mod").value;
    slotDraft.detail = [
      slotDraft.elite ? "精锐" : "",
      ...(slotDraft.labels || []),
      slotDraft.loadout?.skills?.find((x) => x.id === slotDraft.loadout.skillId)
        ?.name,
      slotDraft.loadout?.modules?.find(
        (x) => x.id === slotDraft.loadout.moduleId,
      )?.name,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  function importDialog() {
    popup(
      `<h2>导入阵容</h2><p class="sub">粘贴桌面版或平板版阵容 JSON，也可以使用 dpaste.com 分享链接。</p><textarea id="transfer" class="transfer" rows="7" aria-label="阵容 JSON 或分享链接"></textarea><div id="team-error" class="error"></div>${W.act("team-import-do", "导入为新阵容", "btn gold")}`,
    );
  }
  function share(t) {
    popup(
      `<h2>分享阵容</h2><p class="sub">这份 JSON 含各阶段、装备和目标盟约。</p><textarea id="transfer" readonly class="transfer" rows="7" aria-label="阵容 JSON"></textarea><div class="actions">${W.act("team-copy-text", "复制 JSON")}${W.act("team-system-share", "系统分享")}${W.act("team-publish", "生成 dpaste 公开链接")}</div><div id="team-error" class="hint"></div>`,
    );
    $("transfer").value = JSON.stringify(toPC(t));
  }
  function backup() {
    popup(
      `<h2>本机备份</h2><p>备份包括阵容、攻略、地图摆位、设置与本局进度。恢复会替换这些数据。</p><textarea id="transfer" class="transfer" rows="6" aria-label="备份数据"></textarea><div class="actions">${W.act("team-backup-export", "生成备份")}${W.act("team-copy-text", "复制文本")}${W.act("team-backup-restore", "从文本恢复")}</div><div id="team-error" class="error"></div>`,
    );
  }
  async function recommend(t) {
    return W.engine("recommend", { ...W.request(), team: toPC(t) });
  }
  async function updateCounts(t) {
    const host = $("team-counts");
    if (!host || !Object.keys(t.goals || {}).length) return;
    try {
      const source = toPC(t);
      source.slots = source.editorStages[stageNum(t)].slots;
      const result = await W.engine("recommend", {
        ...W.request(),
        team: source,
      });
      if (host.isConnected)
        host.textContent = result.targets
          .map(
            (g) =>
              g.label +
              " " +
              g.count +
              "/" +
              g.needed +
              (g.reached ? " ✓" : ""),
          )
          .join(" · ");
    } catch {
      if (host.isConnected) host.textContent = "暂时无法计算本阶段的目标盟约";
    }
  }
  function reminderText(t) {
    if (!t.upgradeNotificationsEnabled) return "";
    const r = (t.upgradeReminders || []).filter(
      (p) =>
        db.run.round >= p.startRound &&
        db.run.round <= p.endRound &&
        db.run.terminal < p.targetLevel,
    );
    return r
      .map(
        (p) =>
          `<p class="note">升本提醒 · 目标 ${esc(p.targetLevel)} 本　${esc(p.note)}</p>`,
      )
      .join("");
  }
  function searched(t) {
    return (
      matches(t, filter.toLowerCase()) &&
      (!bondFilter ||
        Object.keys(t.goals || {}).includes(bondFilter) ||
        t.stages.some((s) =>
          s.entries.some((e) => info(e.key).tags.includes(bondFilter)),
        )) &&
      (!statusFilter || statuses[t.id] === statusFilter)
    );
  }
  async function click(a, v) {
    const t = viewing() || active(),
      i = Number(v);
    if (a==="team-workshop" && t) {db.active=t.id;move("planner");void Planning.click("plan-tab","workshop");return;}
    if (a === "team-import") {
      importDialog();
      return;
    }
    if (a === "team-import-do") {
      const el = $("transfer"),
        msg = $("team-error");
      let text = el.value.trim();
      try {
        if (/^https?:\/\//.test(text)) {
          const u = new URL(text);
          if (
            u.hostname !== "dpaste.com" ||
            !/^\/[A-Za-z0-9]+(?:\.txt)?\/?$/.test(u.pathname)
          )
            throw Error("请输入有效的 dpaste 阵容链接。");
          msg.textContent = "正在读取…";
          const response = await fetch(
            "/api/paste?id=" + u.pathname.split("/")[1].split(".")[0],
          );
          if (!response.ok) throw Error("读取分享链接失败。");
          text = await response.text();
        }
        const g = fromPC(JSON.parse(text));
        previewStage = 0;
        incorporate(g,0,[],db.page==="planner" && db.planning?.kind==="workshop" ? "planner" : "teams");
      } catch (e) {
        msg.textContent = "导入失败：" + e.message;
      }
      return;
    }
    if (a === "team-share") {
      share(t);
      return;
    }
    if (a === "team-copy-text") {
      const el = $("transfer");
      el.select();
      if (window.Tablet) Tablet.copy(el.value);
      else await navigator.clipboard.writeText(el.value);
      toast("已复制");
      return;
    }
    if (a === "team-system-share") {
      if (window.Tablet) Tablet.share($("transfer").value);
      else if (navigator.share)
        await navigator.share({ text: $("transfer").value });
      return;
    }
    if (a === "team-publish") {
      if (window.Tablet) {
        $("team-error").textContent = "正在生成公开链接…";
        Tablet.publishPaste($("transfer").value);
      }
      return;
    }
    if (a === "team-backup-export") {
      $("transfer").value = JSON.stringify({
        format: "hongxue-tablet-1",
        data: db,
      });
      return;
    }
    if (a === "team-backup-restore") {
      try {
        const b = JSON.parse($("transfer").value);
        if (
          b.format !== "hongxue-tablet-1" ||
          !Array.isArray(b.data?.teams) ||
          !Array.isArray(b.data?.imports) ||
          !b.data.prefs ||
          !b.data.run
        )
          throw Error("不是本应用的备份");
        for (const t of [...b.data.teams, ...b.data.imports]) {
          if (
            !t.title ||
            !t.stages?.length ||
            !t.stages.every(
              (s) =>
                typeof s.label === "string" &&
                Array.isArray(s.entries) &&
                s.entries.every((e) => typeof e.key === "string"),
            )
          )
            throw Error("阵容结构无效");
          t.source = safeSource(t.source);
        }
        const raw = JSON.stringify(b.data);
        popup(
          `<h2>恢复备份？</h2><p>将恢复 ${b.data.teams.length} 套阵容和 ${b.data.imports.length} 篇导入攻略。</p><button id="restore-confirm" class="btn gold">确认替换</button>`,
        );
        $("restore-confirm").onclick = () => {
          localStorage.setItem(key, raw);
          location.reload();
        };
      } catch (e) {
        $("team-error").textContent = e.message;
      }
      return;
    }
    if (a === "team-search") {
      popup(
        `<h2>筛选我的阵容</h2>${formField("阵容名称或干员", "team-q", filter)}${W.control("目标盟约", W.select("team-filter-bond", [["", "全部"], ...W.data.covenants.covenants.map((c) => c.name)], bondFilter))}${W.control(
          "本局状态",
          W.select(
            "team-filter-status",
            [
              ["", "全部"],
              ["usable", "本局可用"],
              ["check", "待确认 / 修补"],
              ["broken", "不可用"],
            ],
            statusFilter,
          ),
        )}${W.act("team-filter-apply", "应用筛选", "btn gold")}`,
      );
      return;
    }
    if (a === "team-filter-apply") {
      filter = $("team-q").value;
      bondFilter = $("team-filter-bond").value;
      statusFilter = $("team-filter-status").value;
      if (statusFilter) {
        const recs = await Promise.all(
          db.teams.map(async (t) => [t.id, (await recommend(t)).kind]),
        );
        statuses = Object.fromEntries(
          recs.map(([id, k]) => [
            id,
            k === 0 ? "usable" : k === 3 ? "broken" : "check",
          ]),
        );
      }
      close();
      render();
      return;
    }
    if (a === "team-layout") {
      layout(t);
      return;
    }
    if (a === "team-range") {
      ranges(t, i);
      return;
    }
    if (a === "team-range-save") {
      const n = Number($("range-a").value),
        m = Number($("range-b").value);
      if (
        (n || m) &&
        (!Number.isInteger(n) ||
          !Number.isInteger(m) ||
          n < 1 ||
          m < n ||
          m > GuideModel.maxRound ||
          t.stages.some(
            (s, j) => i !== j && s.start && n <= s.end && m >= s.start,
          ))
      ) {
        toast("请选择第 1–15 回合内的区间，各阶段不能重叠");
        return;
      }
      t.stages[i].start = n || null;
      t.stages[i].rangeSource = "手动";
      t.stages[i].end = m || null;
      persist();
      render();
      layout(t);
      return;
    }
    if (a === "team-stage-add") {
      t.stages.push({ label: "新阶段", entries: [], note: "" });
      t.stage = t.stages.length - 1;
      persist();
      close();
      render();
      titleDialog("stage-edit");
      return;
    }
    if (a === "team-final") {
      t.stages.forEach((s, j) => (s.isFinal = j === stageNum(t)));
      persist();
      layout(t);
      return;
    }
    if (a.startsWith("team-stage-")) {
      if (a === "team-stage-del") {
        if (t.stages.length === 1) {
          toast("至少保留一个阶段");
          return;
        }
        popup(
          `<h2>删除「${esc(t.stages[i].label)}」阶段？</h2>${W.act("team-stage-remove", "确认删除", "btn", i)}`,
        );
        return;
      }
      if (a === "team-stage-copy") {
        const s = clone(t.stages[i]);
        s.label += "（副本）";
        s.isFinal = false;
        s.start = s.end = null;
        t.stages.splice(i + 1, 0, s);
      }
      if (a === "team-stage-remove") t.stages.splice(i, 1);
      if (a === "team-stage-up" || a === "team-stage-down") {
        const j = i + (a.endsWith("up") ? -1 : 1);
        if (j < 0 || j >= t.stages.length) return;
        [t.stages[j], t.stages[i]] = [t.stages[i], t.stages[j]];
        t.stage = j;
      }
      t.stage = stageNum(t);
      persist();
      render();
      layout(t);
      return;
    }
    if (a === "team-targets") {
      Planning.chooseGoals(t.goals || {}, (vals) => {
        t.goals = vals;
        persist();
        render();
      });
      return;
    }
    if (a === "team-advice") {
      const advice = await W.engine("advice", {
        ...W.request(),
        ...t.autoPlan,
      });
      popup(
        `<h2>自动路线</h2><p>当前 ${db.run.terminal} 本 · 第 ${db.run.round} 回合</p>${advice.map((x, i) => `<article class="note"><h4>${esc(t.autoPlan.savedRoute.stages[i].definition.name)}</h4>${(x.levels || []).map(Planning.levelCard).join("")}</article>`).join("")}`,
      );
      return;
    }
    if (a === "team-reminders") {
      popup(
        `<h2>升本提醒</h2><label class="checkline"><input type="checkbox" id="remind-enabled" ${t.upgradeNotificationsEnabled ? "checked" : ""}> 在清单显示本回合提醒</label><p class="hint">给需要提醒的等级填写起止回合（2–14）；留空可跳过该等级。</p>${[
          2, 3, 4, 5, 6,
        ]
          .map((n) => {
            const r =
              (t.upgradeReminders || []).find((x) => x.targetLevel === n) || {};
            return `<div class="toolbar listrow"><strong>${n} 本</strong><label>起 <input id="rs-${n}" class="qty" type="number" min="2" max="14" value="${esc(r.startRound || "")}"></label><label>止 <input id="re-${n}" class="qty" type="number" min="2" max="14" value="${esc(r.endRound || "")}"></label><input id="rn-${n}" aria-label="备注" placeholder="备注" maxlength="80" value="${esc(r.note || "")}"></div>`;
          })
          .join("")}${W.act("team-reminder-save", "保存提醒", "btn gold")}`,
      );
      return;
    }
    if (a === "team-reminder-save") {
      const reminders = [];
      for (const targetLevel of [2, 3, 4, 5, 6]) {
        const startRound = Number($("rs-" + targetLevel).value),
          endRound = Number($("re-" + targetLevel).value);
        if (!startRound && !endRound) continue;
        if (
          !Number.isInteger(startRound) ||
          !Number.isInteger(endRound) ||
          startRound < 2 ||
          endRound > 14 ||
          startRound > endRound
        ) {
          toast("请检查起止回合（2–14）");
          return;
        }
        reminders.push({
          targetLevel,
          startRound,
          endRound,
          note: $("rn-" + targetLevel).value.trim(),
        });
      }
      t.upgradeReminders = reminders;
      t.upgradeNotificationsEnabled = $("remind-enabled").checked;
      persist();
      close();
      render();
      return;
    }
    if (a === "team-strategy") {
      W.picker(
        "选择策略",
        W.data.strategies.strategies.map((s) => ({
          id: s.id,
          name: s.name,
          hint: s.initiator,
        })),
        t.strategyIds || [],
        (vals) => {
          t.strategyIds = vals;
          persist();
          render();
        },
        9,
      );
      return;
    }
    if (a === "team-review") {
      const r = await recommend(t);
      popup(
        `<h2>${esc(r.statusText)}</h2><p>${esc(r.note)}</p><p>${esc(r.banned.join("、"))}</p>${r.targets.map((g) => `<p>${esc(g.label)} · ${g.count} / ${g.needed}</p>`).join("")}${W.act("team-repair", "预览全阶段修补", "btn gold")}`,
      );
      return;
    }
    if (a === "team-repair") {
      const r = await W.engine("repair", { ...W.request(), team: toPC(t) });
      repair = r.canSave ? fromPC(r.lineup) : null;
      popup(
        `<h2>修补预览</h2>${r.stages.map((s) => `<div class="note"><strong>${esc(s.name)}</strong><p>${esc(s.changeText)} ${esc(s.warningText)}</p></div>`).join("")}${repair ? W.act("team-repair-save", "另存并追踪", "btn gold") + W.act("team-repair-replace", "应用到当前阵容") : "<p>存在未补齐的阶段，请手动调整。</p>"}`,
      );
      return;
    }
    if (a === "team-repair-save") {
      previewStage = 0;
      incorporate({ ...repair, title: t.title + "（修补）" });
      return;
    }
    if (a === "team-repair-replace") {
      Object.assign(t, repair);
      persist();
      close();
      render();
      return;
    }
    if (a.startsWith("team-slot-")) {
      slotForm();
      const e = slotDraft,
        k = e.key,
        name = info(k).name;
      if (a === "team-slot-label") {
        e.labels = e.labels?.includes(v)
          ? e.labels.filter((n) => n !== v)
          : [...(e.labels || []), v];
        slotEditor(t, k, false);
        return;
      }
      if (a === "team-slot-info") {
        showItem(k);
        return;
      }
      if (a === "team-slot-copy") {
        W.picker(
          "复制干员到其他阶段",
          t.stages
            .map((s, j) => ({ id: String(j), name: s.label }))
            .filter((x) => Number(x.id) !== stageNum(t)),
          [],
          (vals) => {
            for (const val of vals) {
              const st = t.stages[Number(val)];
              st.entries = st.entries.filter((z) => z.key !== k);
              st.entries.push(clone(e));
            }
            persist();
            render();
          },
        );
        return;
      }
      if (a === "team-slot-save") {
        Object.assign(
          t.stages[stageNum(t)].entries.find((x) => x.key === k),
          e,
        );
        persist();
        close();
        render();
        return;
      }
      const eq = Object.values(catalogue)
        .filter((o) => o.kind === "eq")
        .map((o) => ({
          id: o.name,
          name: o.name,
          key: "eq:" + o.name,
          initials: o.initials,
          hint: [o.tier + " 阶", ...o.tags].join(" · "),
        }));
      const cand = (e.candidates || []).map((c) => c.name),
        base = e.equipment || [],
        core = e.coreEquipment || [],
        priority = (e.candidates || [])
          .filter((c) => c.isPriority)
          .map((c) => c.name);
      const opts = a.endsWith("core")
        ? eq.filter((o) => base.includes(o.name))
        : a.endsWith("priority")
          ? eq.filter((o) => cand.includes(o.name))
          : a.endsWith("candidate")
            ? eq.filter((o) => !base.includes(o.name))
            : eq;
      W.picker(
        "选择装备",
        opts,
        a.endsWith("core")
          ? core
          : a.endsWith("priority")
            ? priority
            : a.endsWith("candidate")
              ? cand
              : base,
        (vals) => {
          if (a.endsWith("core")) e.coreEquipment = vals;
          else if (a.endsWith("priority"))
            e.candidates = cand.map((name) => ({
              name,
              isPriority: vals.includes(name),
            }));
          else if (a.endsWith("candidate"))
            e.candidates = vals.map((name) => ({
              name,
              isPriority: priority.includes(name),
            }));
          else {
            e.equipment = vals;
            e.coreEquipment = core.filter((n) => vals.includes(n));
            e.candidates =
              e.candidates?.filter((c) => !vals.includes(c.name)) || [];
          }
          slotEditor(t, k, false);
        },
        a.endsWith("gear")
          ? name === "“暴躁铁皮”"
            ? e.elite
              ? 6
              : 4
            : 2
          : 0,
      );
    }
  }
  window.pastePublished = (url, error) => {
    if (!$("transfer")) return;
    if (error) {
      $("team-error").textContent = error;
      return;
    }
    $("transfer").value = url;
    $("team-error").textContent = "链接已生成，可复制或系统分享。";
  };
  return {
    finalIndex,
    toPC,
    fromPC,
    pane,
    controls,
    basketRows,
    owned,
    mark,
    roundChanged,
    slotEditor,
    click,
    backup,
    searched,
    tracked,
    reminderText,
  };
})();
