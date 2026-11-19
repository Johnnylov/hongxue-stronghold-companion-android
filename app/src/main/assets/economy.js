"use strict";
const Economy = (() => {
  function price(run, table) {
    if (run.terminal >= 6) return null;
    if (Number.isInteger(run.upgrade)) return run.upgrade;
    const origin = table.prices[run.mode]?.[run.terminal - 1];
    const since = run.terminal === 1 ? 1 : run.levelSince;
    if (
      !Number.isInteger(origin) ||
      !Number.isInteger(since) ||
      since > run.round
    )
      return null;
    return Math.max(0, origin - (run.round - since));
  }
  function view(r, data, W) {
    const initial = data.prices[r.mode]?.[r.terminal - 1],
      computed = price(r, data),
      full = r.terminal >= 6;
    const tutorial =
      r.mode === "mode_training_2" ? data.tutorialFunding[r.round] : null;
    const seen = r.round === 1 ? data.observedFirstRound[r.mode] : null;
    const example = Number.isInteger(tutorial)
      ? `本回合基础发放 ${tutorial}`
      : Number.isInteger(seen)
        ? `原版第 1 回合实测画面：余额 ${seen}`
        : "当前余额随购买、出售、刷新和效果变化";
    const since = r.terminal === 1 ? 1 : r.levelSince;
    const costNote = full
      ? "终端已满级"
      : Number.isInteger(initial)
        ? `升至 ${r.terminal + 1} 级基础价 ${initial} · 每过一回合减 1，最低 0`
        : "此模式缺少基础价资料";
    return `<div class="eco-grid"><div class="eco-card"><b>资金</b><strong>${Number.isInteger(r.money) ? r.money + " · 当前余额" : "按手机余额选择"}</strong><small>${esc(example)}</small>
      <input id="run-money" aria-label="实际余额" type="number" min="0" max="9999" value="${r.money ?? ""}">
      <div class="actions">${Number.isInteger(r.money) ? W.act("money-1", "−1", "chip") + W.act("money+1", "＋1", "chip") : ""}${Number.isInteger(tutorial) || Number.isInteger(seen) ? W.act("money-use", "采用 " + (tutorial ?? seen), "linkbtn", String(tutorial ?? seen)) : ""}</div></div>
      <div class="eco-card"><b>升级价</b><strong>${full ? "已满级" : computed === null ? "选择升到本级的回合" : computed + " 资金"}</strong><small>${esc(costNote)}</small>
      ${!full && r.terminal > 1 ? W.control("升至当前等级的回合", W.select("run-levelSince", [["", "请选择"], ...Array.from({ length: r.round }, (_, i) => i + 1)], since || "")) : ""}
      ${full ? "" : `<details><summary>按游戏画面修正价格</summary><input id="run-upgrade" aria-label="本次实际升级价" type="number" min="0" max="${Math.max(20, initial || 0, r.upgrade || 0)}" value="${r.upgrade ?? ""}">${W.act("price-auto", "恢复规则计算", "linkbtn")}</details>`}</div></div>`;
  }
  function changed(r, k) {
    if (k === "mode") {
      r.upgrade = null;
      r.money = null;
    }
    if (k === "terminal") {
      r.levelSince = r.terminal === 1 ? 1 : r.round;
      r.upgrade = null;
    }
    if (k === "levelSince") {
      r.levelSince = Number(r.levelSince) || null;
      r.upgrade = null;
    }
    if (k === "round") {
      r.upgrade = null;
      r.money = null;
      if (r.levelSince > r.round) r.levelSince = null;
    }
  }
  return { price, view, changed };
})();
