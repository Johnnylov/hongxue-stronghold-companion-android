"use strict";
const RunLineups = (() => {
  const W = Workbench;
  const fieldWorker = W.engineWorker();
  const targetWorker = W.engineWorker();
  let field;
  let target;

  function available(name) {
    const op = W.rawOps[name];
    return op && !W.isBanned(name) &&
      (!op.isCustom || db.prefs.custom.includes(name) || db.run.counts[name] > 0);
  }

  function roster() {
    return Object.entries(db.run.counts).filter(([name, n]) => n > 0 && available(name))
      .map(([name, count]) => ({ name, count, elite: Math.min(count, db.run.elite[name] || 0) }));
  }

  function stageFor(team, round) {
    const i = team.stages.findIndex(s => s.start && s.start <= round && round <= (s.end || s.start));
    if (i >= 0) return i;
    // Some guides skip rounds. Show their next published target with its actual round label.
    const next = team.stages.findIndex(s => s.start > round);
    return next >= 0 ? next : Teams.finalIndex(team);
  }

  function signature(units) {
    return JSON.stringify(units.map(u => [u.name, u.count, u.elite]).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  function assess(origin, guide, index, totalHeld) {
    const members = QuickRoster.fromStage(guide.stages[index]);
    const final = QuickRoster.fromStage(guide.stages[Teams.finalIndex(guide)]);
    if (!members.length || [...members, ...final].some(u => !available(u.name)) ||
        Object.keys(guide.goals || {}).some(b => guide.goals[b] > 0 && W.coreBanned(b))) return null;
    let have = 0, size = 0, eliteGap = 0;
    const owned = [], missing = [], upgrades = [];
    for (const unit of members) {
      const n = Math.min(db.run.counts[unit.name] || 0, unit.count);
      const elite = Math.max(0, unit.elite - (db.run.elite[unit.name] || 0));
      have += n;
      size += unit.count;
      eliteGap += elite;
      if (n) owned.push({ name: unit.name, count: n });
      if (unit.count > n) missing.push({ name: unit.name, count: unit.count - n });
      if (elite) upgrades.push({ name: unit.name, count: elite });
    }
    if (!have) return null;
    const finalHave = final.reduce((sum, u) => sum + Math.min(db.run.counts[u.name] || 0, u.count), 0);
    // Dice overlap favors both reusing the pool and having fewer empty slots in the target.
    return { origin, guide, index, have, size, owned, missing, upgrades, eliteGap, finalHave,
      fit: 2 * have / (totalHeld + size), signature: signature(members) + "|" + signature(final) };
  }

  function matches(held) {
    const totalHeld = held.reduce((sum, u) => sum + u.count, 0);
    if (!totalHeld) return [];
    const candidates = [];
    for (const [origin, guides] of [["team", db.teams], ["guide", sources()]]) {
      for (const guide of guides) {
        if (!guide.stages?.length) continue;
        const index = stageFor(guide, db.run.round);
        const candidate = assess(origin, guide, index, totalHeld);
        if (candidate) candidates.push(candidate);
      }
    }
    candidates.sort((a,b) => b.fit - a.fit || b.have - a.have || a.eliteGap - b.eliteGap || b.finalHave - a.finalHave);
    const seen = new Set();
    return candidates.filter(c => {
      if (seen.has(c.signature)) return false;
      seen.add(c.signature);
      return true;
    }).slice(0, 3);
  }

  function names(units) {
    return units.map(u => esc(u.name) + (u.count > 1 ? " ×" + u.count : "")).join("、");
  }

  function fieldMembers(units) {
    const picked = new Map();
    for (const u of units) {
      if (!picked.has(u.name)) picked.set(u.name, { name: u.name, count: 0, elite: 0 });
      const slot = picked.get(u.name);
      slot.count++;
      if (u.isElite) slot.elite++;
    }
    return `<div class="run-members">${[...picked.values()].map(u => `<span>${portrait("op:"+u.name)}<span>${names([u])}${u.elite ? `<small>精锐${u.count > 1 ? " ×"+u.elite : ""}</small>` : ""}</span></span>`).join("")}</div>`;
  }

  function retryField() {
    field = null;
    fieldWorker.stop();
  }
  function pickField(held, map, people, mode) {
    const pool = Maps.candidates(held.filter(u => W.profiles[u.name]?.normalRange?.base));
    const req = { map, pool, people, mode };
    const key = JSON.stringify(req);
    if (field?.key === key) return field.html;
    retryField();
    const job = field = { key, html: "" };
    if (pool.length <= people) {
      job.html = pool.length ? fieldMembers(pool) : '<p class="hint">持有干员缺少部署资料。</p>';
      return job.html;
    }
    const saved = Maps.savedField(req);
    if (saved) {
      const keys = new Set(saved);
      job.html = fieldMembers(pool.filter(p => keys.has(p.key)));
      return job.html;
    }
    if (Maps.waitingForRoster()) {
      field = null;
      return '<p class="hint">完成地图调整后刷新上场建议。</p>';
    }
    job.html = '<p class="hint" role="status">正在从持有池选上场干员…</p>';
    fieldWorker.run("placement", req).then(result => {
      if (field !== job) return;
      const selected = new Set(result.placed.map(p => p.key));
      job.html = fieldMembers(pool.filter(u => selected.has(u.key)));
    }).catch(() => {
      if (field === job) job.html = button("retry-run-field", "重新计算上场建议", "btn light");
    }).finally(() => {
      if (field !== job) return;
      fieldWorker.stop();
      for (const el of document.querySelectorAll("[data-run-field]")) el.innerHTML = job.html;
    });
    return job.html;
  }

  function guideCard(c) {
    const { guide, index } = c, stage = guide.stages[index];
    const source = c.origin === "computed" ? "持有池自动规划" : c.origin === "team" ? "我的阵容" : guide.author ? "森空岛 · " + guide.author : "离线参考";
    return `<article class="run-guide"><h4>${esc(guide.title)}</h4>
      <p class="hint">${esc(source)} · ${esc(GuideModel.stageText(stage))}</p>
      <p><b>已有 ${c.have}/${c.size}</b>　${names(c.owned)}</p>
      <p><b>${c.missing.length ? "还缺" : "干员已齐"}</b>　${names(c.missing)}</p>
      ${c.upgrades.length ? `<p><b>精锐缺口</b>　${names(c.upgrades)}</p>` : ""}
      ${button("follow-run-lineup", "跟踪到购买清单", "btn light", attr("origin",c.origin)+" "+attr("id",guide.id)+" "+attr("index",index))}
    </article>`;
  }

  function targetPanel(held, people, calculate) {
    const req = { people, banned: db.run.banned, bannedBonds: db.run.bannedBonds, custom: db.prefs.custom, transforms: 0 };
    const key = JSON.stringify([req, held]);
    if (target?.key !== key) {
      targetWorker.stop();
      target = { key, html: "", guide: null };
    }
    if (!target.html && calculate) {
      const job = target;
      job.html = '<p class="hint" role="status">正在围绕已有干员规划成型阵容…</p>';
      buildTarget(req, held).then(guide => {
        if (target !== job) return;
        job.guide = guide;
        const match = guide && assess("computed", guide, 0, held.reduce((sum, u) => sum + u.count, 0));
        job.html = match ? guideCard(match) : '<p class="hint">当前持有池与禁用条件下，未找到可推荐的成型组合。</p>';
      }).catch(() => {
        if (target === job) job.html = button("compute-run-target", "重试自动规划", "btn light");
      }).finally(() => {
        if (target !== job) return;
        targetWorker.stop();
        for (const el of document.querySelectorAll("[data-run-target]")) el.innerHTML = job.html;
      });
    }
    return target.html || button("compute-run-target", "按持有干员另算一套", "btn light");
  }

  async function buildTarget(req, held) {
    const counts = new Map();
    const anchors = held.filter(u => !W.rawOps[u.name].requiredStrategyId);
    for (const {name} of anchors) {
      const op = W.rawOps[name];
      for (const bond of new Set([...op.coreCovenants, ...op.additionalCovenants]))
        counts.set(bond, (counts.get(bond) || 0) + 1);
    }
    const goals = W.data.covenants.covenants.filter(b => counts.has(b.name) && !W.coreBanned(b.name));
    goals.sort((a,b) => Number(b.bondType === "SEASON") - Number(a.bondType === "SEASON") || counts.get(b.name) - counts.get(a.name));
    for (const goal of goals) {
      const locked = anchors.filter(u => {
        const op = W.rawOps[u.name];
        return op.coreCovenants.includes(goal.name) || op.additionalCovenants.includes(goal.name);
      }).sort((a,b) => Number(b.elite > 0) - Number(a.elite > 0) || info("op:"+b.name).tier - info("op:"+a.name).tier)
        .slice(0, req.people).map(u => u.name);
      for (const level of goal.bondType === "SEASON" ? [2, 1] : [1]) {
        const goals = { [goal.name]: level };
        const result = await targetWorker.run("target", { ...req, goals, locked });
        const plans = result.plans || [];
        const overlap = p => p.operators.filter(o => db.run.counts[o.name] > 0).length;
        plans.sort((a,b) => overlap(b) - overlap(a) || Number(a.missingHealer) - Number(b.missingHealer) || b.additionalScore - a.additionalScore);
        if (plans.length) {
          const plan = plans[0];
          return { id:"run-target", title:goal.name + " · 本局成型方案", goals,
            stages:[{ label:"成型阵容", isFinal:true, bonds:[goal.name],
              note:"按本局持有池规划，保留" + locked.join("、") + "。", entries:plan.operators.map(o => ({key:"op:"+o.name})) }] };
        }
      }
    }
    return null;
  }

  function computeTarget() {
    target = null;
    targetPanel(roster(), db.board?.people === 9 ? 9 : 8, true);
    render();
  }

  function preview() {
    const best = matches(roster())[0];
    if (!best) return "";
    return `<button class="run-preview" data-act="basket-tab" data-tab="recommend"><span>本局推荐 ›</span>
      <strong>${esc(best.guide.title)}</strong><small>本阶段已持有 ${best.have}/${best.size}</small></button>`;
  }

  function view() {
    const held = roster();
    const edit = W.act("owned", "编辑持有池", "linkbtn");
    if (!held.length) {
      retryField();
      target = null;
      targetWorker.stop();
      return section("本局推荐", edit) + empty("还没有可用的持有干员", "勾选购买清单里的干员，或点「编辑持有池」录入。");
    }
    const map = W.data.garrison_maps.maps.find(m => m.id === db.board?.map) || W.data.garrison_maps.maps[0];
    const people = db.board?.people === 9 ? 9 : 8, mode = db.board?.mode ?? 1;
    const cards = matches(held);
    return section("当前上场建议", edit) +
      `<p class="hint">${esc(map.name)} · ${esc(["战斗","平衡","叠层"][mode])} · 地图模拟 ${people} 人位</p>
      <div data-run-field>${pickField(held, map.id, people, mode)}</div>` +
      section("第 " + db.run.round + " 回合 · 推荐阵容") +
      cards.map(guideCard).join("") +
      `<div data-run-target>${targetPanel(held, people, !cards.length)}</div>`;
  }

  function follow(origin, id, index) {
    const guide = origin === "computed" ? target?.guide : (origin === "team" ? db.teams : sources()).find(g => g.id === id);
    if (!guide?.stages[index]) return;
    const tokens = new Set(origin === "team" ? guide.owned.filter(t => JSON.parse(t)[0].startsWith("eq:")) : []);
    for (const stage of guide.stages) {
      for (const row of GuideModel.shoppingRows(stage)) {
        const [key, copy] = JSON.parse(row.token);
        if (key.startsWith("op:") && db.run.counts[key.slice(3)] >= copy) tokens.add(row.token);
      }
    }
    db.prefs.basketTab = "shop";
    const destination = db.page === "map" ? "map" : "teams";
    if (destination === "map") db.board.tab = "board";
    if (origin === "team") {
      guide.owned = [...tokens];
      guide.stage = index;
      db.active = guide.id;
      move(destination, destination === "teams" ? guide.id : null);
    } else incorporate(guide, index, [...tokens], destination);
  }
  function bestMatch() { return matches(roster())[0] || null; }
  return { view, follow, preview, retryField, computeTarget, bestMatch };
})();
