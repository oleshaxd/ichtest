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
    const match = String(upgrade?.effect || "").match(/effect_def\s*,\s*(\d+)/i);
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
  function upgradeIndex() {
    return new Map((definitions?.upgrades || []).map(u => [Number(u.id), u]));
  }
  function resolveSpecialization(name, tier, choiceName, upgradesById, effectsById) {
    const heroTiers = tiersFor(name);
    const tierData = heroTiers.find(t => Number(t.level) === Number(tier));
    const choice = tierData?.choices?.find(c => c.name === choiceName);
    if (!choice) return { name: choiceName, missing: true };
    const upgrades = (choice.upgradeIds || []).map(id => upgradesById.get(Number(id))).filter(Boolean);
    const effects = [];
    for (const upgrade of upgrades) {
      const ref = effectReference(upgrade);
      if (ref !== null) {
        const def = effectsById.get(ref);
        effects.push({
          source: upgrade.effect,
          effectId: ref,
          description: def?.description?.desc || def?.description || "",
          keys: (def?.effect_keys || []).map(k => ({
            effect_string: k.effect_string || "",
            targets: k.targets || [],
            filter_targets: k.filter_targets || [],
            requirements: k.requirements || [],
            stacks_on_trigger: k.stacks_on_trigger || null,
            max_stacks: k.max_stacks ?? null,
            stack_duration: k.stack_duration ?? null
          })),
          requirements: def?.requirements || []
        });
      } else {
        const direct = String(upgrade.effect || "");
        const m = direct.match(/^buff_upgrade\s*,\s*([^,]+)\s*,\s*(\d+)/i);
        const targetUpgrade = m ? upgradesById.get(Number(m[2])) : null;
        effects.push({
          source: direct,
          description: targetUpgrade
            ? 'Улучшение #' + targetUpgrade.id + ' «' + (targetUpgrade.name || targetUpgrade.specialization_name || 'без названия') + '»; прямой эффект задаётся игровой командой ' + direct
            : 'Прямой игровой эффект: ' + (direct || 'не указан'),
          keys: [],
          requirements: []
        });
      }
    }
    return { name: choiceName, upgrades, effects, missing: false };
  }
  function renderResults() {
    const names = availableNames();
    const chosen = [];
    const upgradesById = upgradeIndex();
    const effectsById = new Map((definitions?.effectDefinitions || []).map(e => [Number(e.id), e]));
    for (const name of names) {
      const tiers = tiersFor(name);
      for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        const value = specs[name + "::" + tier.level] || (i === 0 ? specs[name] : "") || "";
        if (value) chosen.push({
          label: name + ' — ур. ' + tier.level + ': ' + value,
          resolved: resolveSpecialization(name, tier.level, value, upgradesById, effectsById)
        });
      }
    }
    $("coverage").textContent = 'В формации: ' + names.length + ' чемпионов. Выбрано специализаций: ' + chosen.length + '.';
    gameDataStatus();
    $("dps").textContent = "Не рассчитан";
    $("bud").textContent = "Не рассчитан";
    $("resultNote").textContent = names.length
      ? 'Специализации связаны с игровыми улучшениями и определениями эффектов там, где связь найдена. DPS/BUD пока не рассчитываются.'
      : 'Добавь чемпионов в блок «Формации игры».';
    $("effectList").innerHTML = chosen.length
      ? chosen.map(item => {
          const resolved = item.resolved;
          if (resolved.missing) return '<li><strong>' + esc(item.label) + '</strong><div class="muted">Не удалось сопоставить выбор со справочником специализаций.</div></li>';
          const detail = resolved.effects.map(effect => {
            const keys = effect.keys.map(key => {
              const targets = key.targets.length ? ' · цели: ' + key.targets.join(', ') : '';
              const filters = key.filter_targets.length ? ' · фильтры: ' + key.filter_targets.map(f => [f.type, f.tags || f.tag || ''].filter(Boolean).join(': ')).join('; ') : '';
              const conditions = key.stacks_on_trigger ? ' · триггер: ' + JSON.stringify(key.stacks_on_trigger) : '';
              return '<div class="muted" style="margin-left:12px">Ключ: <code>' + esc(key.effect_string) + '</code>' + esc(targets + filters + conditions) + '</div>';
            }).join("");
            return '<div style="margin:4px 0 8px 12px"><div>' + esc(effect.description || 'Описание эффекта отсутствует в выгрузке.') + '</div>' +
              '<div class="muted">Источник: <code>' + esc(effect.source) + '</code>' + (effect.effectId ? ' · effect_def #' + effect.effectId : '') + '</div>' + keys + '</div>';
          }).join("");
          return '<li><strong>' + esc(item.label) + '</strong>' + (detail || '<div class="muted">Выгрузка не содержит разобранного effect_def для этой специализации.</div>') + '</li>';
        }).join("")
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