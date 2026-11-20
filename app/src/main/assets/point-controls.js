"use strict";
const PointControls = (() => {
  const layer = document.createElement("dialog");
  layer.id = "point-dialog";
  document.body.append(layer);
  const mapped = new WeakMap(),
    byButton = new WeakMap();
  let target = null,
    seq = 0,
    group = "",
    bucket = "",
    digits = [0, 0, 0, 0],
    destId = 0;
  const selectable =
    "input:not([type]),input[type=text],input[type=number],input[type=search],textarea:not([readonly])";
  function caption(el) {
    const titles = {
      guideSearch: "选择攻略、盟约或干员",
      pickSearch: "选择筛选条件",
      "wb-search": "选择名称或分类",
      "atlas-q": "选择图鉴关键词",
      "team-q": "选择阵容或干员",
      guideUrl: "选择攻略链接",
      transfer: "导入内容",
      "range-a": "开始回合",
      "range-b": "结束回合",
      "run-round": "回合",
      "run-terminal": "终端等级",
      "run-upgrade": "升级价",
    };
    return (
      titles[el.id] ||
      el.closest("label")?.querySelector("span")?.textContent ||
      el.getAttribute("aria-label") ||
      el.placeholder ||
      "选择内容"
    );
  }
  function defaultName() {
    let index = db?.teams?.length + 1 || 1;
    while (db?.teams?.some((t) => t.title === "自选阵容 " + index)) index++;
    return "自选阵容 " + index;
  }
  function display(el) {
    const btn = mapped.get(el);
    if (!btn) return;
    const n = el.value;
    btn.textContent = n
      ? n.length > 42
        ? n.slice(0, 40) + "…"
        : n
      : el.type === "search"
        ? "全部 · 点选筛选"
        : el.id === "transfer" || el.id === "guideUrl"
          ? "从剪贴板或文件选择"
          : "未设置 · 点选";
    btn.setAttribute("aria-label", caption(el) + "：" + btn.textContent);
  }
  function adapt(el) {
    if (mapped.has(el) || el.readOnly || !el.id || layer.contains(el)) return;
    if (el.id === "name" && !el.value) el.value = defaultName();
    const b = document.createElement("button");
    b.type = "button";
    b.className = "point-input";
    b.setAttribute("aria-haspopup", "dialog");
    el.after(b);
    el.hidden = true;
    el.tabIndex = -1;
    el.inputMode = "none";
    el.setAttribute("aria-hidden", "true");
    mapped.set(el, b);
    byButton.set(b, el);
    display(el);
  }
  function scan(node) {
    if (node.nodeType !== 1 || node === layer || layer.contains(node)) return;
    if (node.matches(selectable)) adapt(node);
    node.querySelectorAll(selectable).forEach(adapt);
  }
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) scan(n);
  }).observe(document.body, { childList: true, subtree: true });
  function option(text, value, checked = false, kind = "value") {
    return `<button type="button" class="point-option" data-point="${kind}" data-value="${esc(value)}" aria-pressed="${checked}">${esc(text)}</button>`;
  }
  function closePicker() {
    if (layer.open) layer.close();
    target = null;
    destId = ++seq;
  }
  function apply(value) {
    const el = target;
    closePicker();
    if (!el?.isConnected) return;
    el.value = value;
    el.setCustomValidity?.("");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    display(el);
  }
  function textGroups(el) {
    const names = Object.values(catalogue || {}),
      ops = names.filter((i) => i.kind === "op").map((i) => i.name),
      eq = names.filter((i) => i.kind === "eq").map((i) => i.name);
    if (el.id === "name") {
      const isStage = !!$("note");
      return {
        常用: isStage
          ? ["开局", "前期", "中期", "后期", "成型", "挂件", "过渡", "终局"]
          : [
              defaultName(),
              ...Workbench.data.covenants.covenants
                .filter((c) => c.bondType === "SEASON")
                .map((c) => c.name + "阵容"),
            ],
      };
    }
    if (el.id === "note" || el.id.startsWith("rn-"))
      return {
        常用: [
          "优先寻找核心干员",
          "保留对子，优先晋升精锐",
          "优先升级终端",
          "检查治疗和阻挡",
          "补齐核心盟约",
          "按本局商店灵活调整",
        ],
      };
    const guides = sources(),
      labels = Array.from(new Set(guides.flatMap((g) => g.tags || [])));
    const allies = Workbench.data.covenants.covenants.map((c) => c.name);
    if (el.id === "guideSearch")
      return {
        攻略: guides.map((g) => g.title),
        盟约: allies,
        干员: ops,
        作者: guides.map((g) => g.author).filter(Boolean),
      };
    if (el.id === "team-q")
      return { 阵容: db.teams.map((t) => t.title), 干员: ops };
    return {
      盟约: allies,
      干员: ops,
      装备: eq,
      类别: [...new Set(names.flatMap((n) => n.tags || []))],
      策略: Workbench.data.strategies.strategies.map((s) => s.name),
    };
  }
  function numeric(el) {
    const min = Number(el.min || 0),
      max = Number(el.max || 99),
      current = el.value === "" ? null : Number(el.value);
    if (max <= 99) {
      const options = Array.from({ length: max - min + 1 }, (_, i) => i + min);
      let area = options;
      if (options.length > 30) {
        const page = Math.floor((current ?? min) / 10),
          buckets = Array.from(new Set(options.map((n) => Math.floor(n / 10))));
        if (bucket === "") bucket = String(page);
        area = options.filter((n) => Math.floor(n / 10) === Number(bucket));
        return `<div class="point-groups">${buckets.map((g) => option(Math.max(g * 10, min) + "–" + Math.min(g * 10 + 9, max), g, String(g) === bucket, "bucket")).join("")}</div><div class="point-grid">${area.map((n) => option(n, n, n === current)).join("")}</div>`;
      }
      return `<div class="point-grid">${area.map((n) => option(n, n, n === current)).join("")}</div>`;
    }
    return `<div class="point-grid">${[
      0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100,
    ]
      .filter((n) => n >= min && n <= max)
      .map((n) => option(n, n, n === current))
      .join("")}</div><p class="hint controls">其他金额可按数位选择</p>
      ${["千位", "百位", "十位", "个位"].map((label, i) => `<div class="digit-row"><small>${label}</small>${Array.from({ length: 10 }, (_, n) => option(n, i + "/" + n, digits[i] === n, "digit")).join("")}</div>`).join("")}<div class="actions">${option("确认数值 " + Number(digits.join("")), Number(digits.join("")), true)}</div>`;
  }
  function editor() {
    const el = target;
    if (!el) return;
    let html = "",
      extra = "";
    if (el.type === "number") {
      html = numeric(el);
      if (!["run-round", "run-terminal"].includes(el.id))
        extra += option("未设置", "", "" === el.value);
    } else if (["guideUrl", "transfer"].includes(el.id)) {
      html = `<p class="sub">${el.id === "guideUrl" ? "从森空岛复制攻略详情链接后，在这里点粘贴。" : "可以选择阵容或备份的 JSON 文件，也可以粘贴已复制的内容。"}</p>`;
      if (el.id === "guideUrl")
        html += `<div class="point-list">${GuideModel.featured.map((g) => option(g.title, GuideModel.base + "/detail?guideId=" + g.id)).join("")}</div>`;
      extra += option("从剪贴板粘贴", "", false, "clipboard");
      if (el.id === "transfer")
        extra += option("选择 JSON 文件", "", false, "file");
    } else {
      const groups = textGroups(el);
      if (!(group in groups)) group = Object.keys(groups)[0];
      const all = Array.from(new Set(groups[group] || []));
      let opts = all;
      if (all.length > 38) {
        const byInitial = (s) =>
          (catalogue["op:" + s]?.initials ||
            catalogue["eq:" + s]?.initials ||
            s)[0]?.toUpperCase() || "#";
        const prefixes = [...new Set(all.map(byInitial))].sort();
        if (!prefixes.includes(bucket)) bucket = prefixes[0];
        html += `<div class="point-alphabet">${prefixes.map((z) => option(z, z, z === bucket, "bucket")).join("")}</div>`;
        opts = all.filter((s) => byInitial(s) === bucket);
      }
      html =
        `<div class="point-groups">${Object.keys(groups)
          .map((s) => option(s, s, group === s, "group"))
          .join("")}</div>` +
        html +
        `<div class="point-list">${opts.map((s) => option(s, s, s === el.value)).join("")}</div>`;
      if (el.id !== "name")
        extra += option(
          el.type === "search" ? "全部 / 清除筛选" : "清空",
          "",
          !el.value,
        );
      extra += option("粘贴已有文本", "", false, "clipboard");
    }
    layer.innerHTML = `<div class="toolbar"><h2>${esc(caption(el))}</h2>${option("关闭", "", false, "close")}</div>${html}<div class="actions controls">${extra}</div><p id="point-message" class="error" role="status"></p>`;
  }
  function open(el) {
    target = el;
    destId = ++seq;
    group = "";
    bucket = "";
    digits = String(Math.max(0, Number(el.value) || 0))
      .padStart(4, "0")
      .slice(-4)
      .split("")
      .map(Number);
    editor();
    if (!layer.open) layer.showModal();
  }
  async function readClipboard() {
    if (window.Tablet?.readClipboard) {
      Tablet.readClipboard(destId);
      return;
    }
    try {
      accept(destId, await navigator.clipboard.readText(), "");
    } catch {
      accept(destId, "", "请先复制内容并允许读取剪贴板。");
    }
  }
  function accept(id, value, error) {
    if (id !== destId || !target || !layer.open) return;
    if (error || !value) {
      $("point-message").textContent = error || "剪贴板为空";
      return;
    }
    if (!["transfer", "guideUrl"].includes(target.id) && target.maxLength > 0)
      value = value.slice(0, target.maxLength);
    apply(value.trim());
  }
  layer.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-point]");
    if (!b) return;
    const k = b.dataset.point,
      v = b.dataset.value;
    if (k === "close") {
      closePicker();
      return;
    }
    if (k === "clipboard") {
      readClipboard();
      return;
    }
    if (k === "file") {
      if (window.Tablet?.openJson) Tablet.openJson(destId);
      else {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json,text/plain";
        const id = destId;
        input.onchange = async () => {
          const f = input.files[0];
          if (f && f.size <= 6 * 1024 * 1024) accept(id, await f.text(), "");
          else accept(id, "", "文件超过 6 MB");
        };
        input.click();
      }
      return;
    }
    if (k === "group") {
      group = v;
      bucket = "";
      editor();
      return;
    }
    if (k === "bucket") {
      bucket = v;
      editor();
      return;
    }
    if (k === "digit") {
      const [pos, n] = v.split("/").map(Number);
      digits[pos] = n;
      editor();
      return;
    }
    if (k === "value") apply(v);
  });
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest(".point-input");
    if (b) {
      ev.preventDefault();
      open(byButton.get(b));
    } else
      queueMicrotask(() =>
        document.querySelectorAll(selectable).forEach(display),
      );
  });
  layer.addEventListener("cancel", () => {
    target = null;
    destId = ++seq;
  });
  document.addEventListener("focusin", (ev) => {
    if (mapped.has(ev.target)) ev.target.blur();
  });
  scan(document.body);
  return { accept, isOpen: () => layer.open, close: closePicker };
})();
