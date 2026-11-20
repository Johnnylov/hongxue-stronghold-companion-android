"use strict";
const Economy = (() => {
  const maxMoney = 20;
  function balance(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(maxMoney, Math.max(0, Math.trunc(n))) : null;
  }
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
  function funding(mode, round, data) {
    if (mode === "mode_training_2" && Number.isInteger(data.tutorialFunding[round]))
      return {amount:data.tutorialFunding[round], label:"入门协议基础发放"};
    const sample = data.roundFunding?.[mode];
    if (Number.isInteger(sample?.amounts[round]))
      return {amount:sample.amounts[round], label:sample.label};
    const multiplayer = Workbench.data.multiplayer_bans[mode];
    if (multiplayer && round >= 1 && round <= GuideModel.maxRound)
      return {amount:Math.min(round+3,12), label:round<=3 ? "多人开局发放参考" : "多人复刻开局估算"};
    if (round === 1 && Number.isInteger(data.observedFirstRound[mode]))
      return {amount:data.observedFirstRound[mode], label:"原版首回合画面余额"};
    return null;
  }
  function fundingTable(mode, data) {
    const rows = [];
    for (let round = 1; round <= GuideModel.maxRound; round++) {
      const record = funding(mode, round, data);
      if (record) rows.push(`<span>第 ${round} 回合 <b>${record.amount}</b></span>`);
    }
    const multiplayer = Workbench.data.multiplayer_bans[mode];
    const comparison = !multiplayer && mode !== "mode_training_2" && mode !== "mode_single_funny" && mode !== "mode_single_1"
      ? '<small>其他模式对照：规程等级 1 的第 1–8 回合依次发 4–11，第 9–14 回合均发 11。</small>' : "";
    return `<details class="round-funding"><summary>各回合资金参考</summary>${rows.length ? `<div>${rows.join("")}</div>` : ""}
      <small>${multiplayer ? "Stronghold-Protocol 多人规程模型。第 4 回合起为复刻估算，额外收益依实际画面。" : esc(data.roundFunding?.[mode]?.note || (mode === "mode_training_2" ? "入门协议按客户端教学配置发放。" : rows.length ? "金额取自原版游戏画面。" : "当前模式的基础发放表待核实。"))} 通常在休整期结束时清空剩余资金。</small>${comparison}</details>`;
  }
  function view(r, data, W) {
    const initial = data.prices[r.mode]?.[r.terminal - 1],
      computed = price(r, data),
      full = r.terminal >= 6;
    const income = funding(r.mode, r.round, data);
    const extra = ItemIncome.total(r);
    const opening = income ? balance(income.amount + extra) : null;
    const example = income ? `${income.label} · ${income.amount} 资金` : "本模式这一回合的发放额待核实，可直接点选手机上的余额。";
    const since = r.terminal === 1 ? 1 : r.levelSince;
    const costNote = full
      ? "终端已满级"
      : Number.isInteger(initial)
        ? `升至 ${r.terminal + 1} 级基础价 ${initial} · 每过一回合减 1，最低 0`
        : "此模式缺少基础价资料";
    const amounts = Array.from({length:maxMoney + 1}, (_, n) =>
      `<button type="button" class="chip" data-w="money-use" data-v="${n}" aria-pressed="${r.money === n}">${n}</button>`).join("");
    return `<div class="eco-grid"><div class="eco-card"><b>资金</b><strong>${Number.isInteger(r.money) ? r.money + " · 当前余额" : "按手机余额选择"}</strong><small>${esc(example)}</small>
      <div class="balance-choices" role="group" aria-label="本局资金">${amounts}</div>
      <div class="actions">${W.act("income-open","记录道具收入","btn light")}${extra ? `<small>本回合道具 +${extra}</small>` : ""}${r.money != null ? W.act("money-use", "清除余额", "linkbtn") : ""}${income ? W.act("money-use", "采用 " + opening, "linkbtn", String(opening)) : ""}</div>${fundingTable(r.mode,data)}</div>
      <div class="eco-card"><b>升级价</b><strong>${full ? "已满级" : computed === null ? "选择升到本级的回合" : computed + " 资金"}</strong><small>${esc(costNote)}</small>
      ${!full && r.terminal > 1 ? W.control("升至当前等级的回合", W.select("run-levelSince", [["", "请选择"], ...Array.from({ length: r.round }, (_, i) => i + 1)], since || "")) : ""}
      ${full ? "" : `<details><summary>按游戏画面修正价格</summary><input id="run-upgrade" aria-label="本次实际升级价" type="number" min="0" max="${Math.max(20, initial || 0, r.upgrade || 0)}" value="${r.upgrade ?? ""}">${W.act("price-auto", "恢复规则计算", "linkbtn")}</details>`}</div></div>`;
  }
  function changed(r, k) {
    if (k === "round" || k === "mode") r.incomeAnchor=null;
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
  return { price, view, changed, balance, funding };
})();
