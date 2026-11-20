"use strict";
const StageMenu = (() => {
  let expandedId = "";

  function html(stages, index, id, label = "当前阶段") {
    const open = expandedId === id;
    const items = stages.map((s, i) => `<button type="button" role="option" tabindex="-1" value="${i}"
      aria-selected="${i === index}">${esc(GuideModel.stageText(s))}</button>`);
    return `<div class="stage-menu"><label for="${id}" id="${id}-label">${esc(label)}</label>
      <button type="button" id="${id}" value="${index}" class="stage-trigger compact-select"
        role="combobox" aria-haspopup="listbox" aria-expanded="${open}" aria-controls="${id}-options"
        aria-labelledby="${id}-label ${id}-value"><span id="${id}-value">${esc(GuideModel.stageText(stages[index]))}</span></button>
      <div class="stage-options" role="listbox" id="${id}-options" aria-labelledby="${id}-label" ${open ? "" : "hidden"}>${items.join("")}</div></div>`;
  }

  function closeMenu(restoreFocus = false) {
    if (!expandedId) return false;
    const trigger = document.getElementById(expandedId);
    expandedId = "";
    if (!trigger) return false;
    trigger.setAttribute("aria-expanded", "false");
    trigger.nextElementSibling.hidden = true;
    if (restoreFocus) trigger.focus({preventScroll:true});
    return true;
  }

  function openMenu(trigger, focus) {
    if (expandedId !== trigger.id) closeMenu();
    expandedId = trigger.id;
    trigger.setAttribute("aria-expanded", "true");
    const list = trigger.nextElementSibling;
    list.hidden = false;
    const selected = list.querySelector('[aria-selected="true"]');
    if (focus) selected.focus({preventScroll:true});
    selected.scrollIntoView({block:"nearest", inline:"nearest"});
  }

  document.addEventListener("click", event => {
    const wrapper = event.target.closest(".stage-menu");
    if (!wrapper) { if (expandedId) closeMenu(); return; }
    const trigger = wrapper.querySelector(".stage-trigger");
    const option = event.target.closest('[role="option"]');
    if (option) {
      const id = trigger.id;
      closeMenu();
      trigger.value = option.value;
      trigger.dispatchEvent(new Event("change", {bubbles:true}));
      document.getElementById(id)?.focus({preventScroll:true});
    } else if (event.target.closest(".stage-trigger")) {
      if (expandedId === trigger.id) closeMenu();
      else openMenu(trigger, event.detail === 0);
    }
  });

  document.addEventListener("focusin", event => {
    if (expandedId && event.target.closest(".stage-menu")?.querySelector(".stage-trigger")?.id !== expandedId) closeMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && expandedId) { event.preventDefault(); closeMenu(true); return; }
    const wrapper = event.target.closest(".stage-menu");
    if (!wrapper || !["ArrowDown","ArrowUp","Home","End"].includes(event.key)) return;
    event.preventDefault();
    const trigger = wrapper.querySelector(".stage-trigger");
    if (expandedId !== trigger.id) { openMenu(trigger, true); return; }
    const options = Array.from(wrapper.querySelectorAll('[role="option"]'));
    const focused = options.indexOf(document.activeElement);
    const from = focused < 0 ? Number(trigger.value) : focused;
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
      Math.min(options.length - 1, Math.max(0, from + (event.key === "ArrowDown" ? 1 : -1)));
    options[next].focus();
  });
  return {html, close:closeMenu};
})();
