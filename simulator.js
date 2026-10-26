/* Idle Champions Helper — formation-linked DPS/BUD panel.
 * Embedded mode reads champions and specialization choices from the main formation.
 * DPS/BUD remains disabled until verified game formulas are available.
 */
(() => {
  "use strict";
  const DATA_URL = "./data/simulator-champions.json";
  const SPECS_URL = "./data/specializations-tiered.json";
  const DEFINITIONS_URL = "./data/game-definitions.json";
  const $ = (id) => document.getElementById(id);
  if (!$("roster") || !$("selected")) return;

  const embedded = !!$("simulatorPanel");
  let roster = [];
  let formation = [];
  let formType = "diamond";
  let data = null;
  let definitions = null;
  let definitionsError = "";
  let specializationData = { tiers: {} };
  let selected = [];
  let specs = {};

  function safeParse(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }
  function readSources() {
    roster = safeParse(localStorage.getItem("icRoster"), []);
    formation = safeParse(localStorage.getItem("icFormation"), []);
    formType = localStorage.getItem("icFormType") || "diamond";
    specs = safeParse(localStorage.getItem("icChampionSpecs"), {});
  }
  function availableNames() {
    return embedded
      ? [...new Set(formation.filter(Boolean))]
      : [...new Set(roster)];
  }
  function slotOf(name) {
    const i = formation.findIndex((n) => n === name);
    return i < 0 ? null : i + 1;
  }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }
  function tiersFor(name) {
    const tiers = specializationData?.tiers || {};
    return tiers[name] || Object.entries(tiers).find(([key]) => key.trim().toLowerCase() === name.trim().toLowerCase())?.[1] || [];
  }
  function renderRoster() {
    const box = $("roster");
    const names = availableNames();
    if (!names.length) {
      box.innerHTML = '<p class="muted">Формация пока пустая. Поставь чемпионов в слоты выше.</p>';
      return;
    }
    box.innerHTML = names.map((name) => {
      const slot = slotOf(name);
      const record = data?.champions?.[name];
      return '<div class="roster-item"><span><strong>' + esc(name) + '</strong><small>' +
        (slot ? 'Слот ' + slot + ' · ' : '') +
        (record ? 'Есть запись в справочной базе' : 'Справочная запись пока неполная') +
        '</small></span></div>';
    }).join("");
  }
  function renderSelected() {
    const box = $("selected");
    const names = availableNames();
    if (!names.length) {
      box.innerHTML = '<p class="muted">Выбери специализации непосредственно в блоке «Формации игры».</p>';
      return;
    }
    box.innerHTML = names.map((name) => {
      const tiers = tiersFor(name);
      const choices = tiers.map((tier, i) => {
        const key = name + "::" + tier.level;
        const current = specs[key] || (i === 0 ? specs[name] : "") || "";
        const chosen = current ? '<b>' + esc(current) + '</b>' : '<span class="muted">не выбрана</span>';
        return '<li><small>Ур. ' + esc(tier.level) + ':</small> ' + chosen + '</li>';
      }).join("");
      const detail = tiers.length
        ? '<ul style="margin:5px 0 0;padding-left:20px">' + choices + '</ul>'
        : '<p class="muted" style="margin:5px 0 0">В базе пока нет уровневых данных специализаций для этого чемпиона.</p>';
      return '<article class="champion"><div class="champion-title"><strong>' + esc(name) +
        '</strong>' + (slotOf(name) ? '<small>Слот ' + slotOf(name) + '</small>' : '') +
        '</div>' + detail + '</article>';
    }).join("");
  }
  function effectReference(upgrade) {
    const match = String(upgrade?.effect || "").match(/effect_def\\s*,\\s*(\\d+)/i);
    return match ? Number(match[1]) : null;
  }
  function gameDataStatus() {
    const node = $("gameDataStatus");
    if (!node) return;
    if (!definitions) {
      node.textContent = definitionsError
        ? "Игровые определения не загружены: " + definitionsError + ". Ожидаемый файл: " + DEFINITIONS_URL
        : "Загрузка игровых определений…";
      return;
    }
    const effectIds = new Set((definitions.effectDefinitions || []).map(e => Number(e.id)));
    const specUpgrades = (definitions.upgrades || []).filter(u => u.specialization_name);
    const linked = specUpgrades.filter(u => {
      const id = effectReference(u);
      return id !== null && effectIds.has(id);
    });
    node.textContent = "Игровые определения подключены · " +
      (definitions.heroes || []).length + " чемпионов · " +
      (definitions.upgrades || []).length + " улучшений · " +
      effectIds.size + " описаний эффектов · " +
      (definitions.effectKeyDefinitions || []).length + " типов эффектов. " +
      "Специализаций: " + specUpgrades.length + ", с найденным effect_def: " + linked.length + ".";
  }
  function renderResults() {
    const names = availableNames();
    const chosen = [];
    for (const name of names) {
      const tiers = tiersFor(name);
      for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        const value = specs[name + "::" + tier.level] || (i === 0 ? specs[name] : "") || "";
        if (value) chosen.push(name + ' — ур. ' + tier.level + ': ' + value);
      }
    }
    $("coverage").textContent = 'В формации: ' + names.length + ' чемпионов. Выбрано специализаций: ' + chosen.length + '.';
    gameDataStatus();
    $("dps").textContent = "Не рассчитан";
    $("bud").textContent = "Не рассчитан";
    $("resultNote").textContent = names.length
      ? 'Формация и специализации синхронизированы. Точные DPS/BUD пока не рассчитываются: для этого нужны проверенные формулы атак, усилений и позиционных условий.'
      : 'Добавь чемпионов в блок «Формации игры».';
    $("effectList").innerHTML = chosen.length
      ? chosen.map(item => '<li>' + esc(item) + '</li>').join("")
      : '<li>Пока не выбраны специализации в блоке «Формации игры».</li>';
  }
  function refreshFromMain() {
    readSources();
    selected = availableNames();
    if (embedded) {
      $("sourceInfo").textContent = 'Источник: формация «' + formType + '» выше. Симулятор автоматически читает ' +
        formation.filter(Boolean).length + ' занятых слотов и выбранные специализации.';
    } else {
      $("sourceInfo").textContent = 'Ростер: ' + roster.length + ' чемпионов · формация «' + formType + '»: ' + formation.filter(Boolean).length + ' занятых слотов.';
    }
    renderRoster();
    renderSelected();
    renderResults();
  }
  async function init() {
    readSources();
    const results = await Promise.allSettled([
      fetch(DATA_URL, { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject(new Error("simulator data unavailable"))),
      fetch(SPECS_URL, { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject(new Error("specialization data unavailable"))),
      fetch(DEFINITIONS_URL, { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
    ]);
    data = results[0].status === "fulfilled" ? results[0].value : { champions: {} };
    specializationData = results[1].status === "fulfilled" ? results[1].value : { tiers: {} };
    definitions = results[2].status === "fulfilled" ? results[2].value : null;
    definitionsError = results[2].status === "rejected" ? String(results[2].reason?.message || results[2].reason) : "";
    const statusHost = $("sourceInfo");
    if (statusHost && !$("gameDataStatus")) {
      const status = document.createElement("div");
      status.id = "gameDataStatus";
      status.className = "status";
      statusHost.insertAdjacentElement("afterend", status);
    }
    if ($("dataVersion")) $("dataVersion").textContent = data.gameDataVersion || "Локальный кэш";
    refreshFromMain();
    gameDataStatus();
  }
  window.addEventListener("ic-helper-updated", refreshFromMain);
  window.addEventListener("ic-specs-updated", refreshFromMain);
  window.addEventListener("storage", (event) => {
    if (["icRoster", "icFormation", "icFormType", "icChampionSpecs"].includes(event.key)) refreshFromMain();
  });
  init();
})();