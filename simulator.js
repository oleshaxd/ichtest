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
  function parseEffectEntry(raw) {
    if (raw && typeof raw === "object") {
      return { command: String(raw.effect_string || ""), description: String(raw.description || "") };
    }
    const value = String(raw || "").trim();
    if (value.startsWith("{")) {
      const parsed = safeParse(value, null);
      if (parsed && typeof parsed === "object") {
        return { command: String(parsed.effect_string || ""), description: String(parsed.description || "") };
      }
    }
    return { command: value, description: "" };
  }
  function interpolateEffectText(value, params = {}) {
    let result = String(value ?? "");
    for (const [key, replacement] of Object.entries(params)) {
      result = result.replace(new RegExp("\\$\\(" + key + "\\)", "gi"), String(replacement));
    }
    return result;
  }
  function effectDetails(raw, upgradesById, effectsById, depth = 0, inheritedParams = {}) {
    const entry = parseEffectEntry(raw);
    const source = entry.command;
    const refMatch = source.match(/^effect_def\s*,\s*(\d+)/i);
    if (refMatch) {
      const ref = Number(refMatch[1]);
      const def = effectsById.get(ref);
      return {
        source,
        effectId: ref,
        description: interpolateEffectText(entry.description || def?.description?.desc || def?.description || "", inheritedParams),
        keys: (def?.effect_keys || []).map(k => ({
          effect_string: k.effect_string || "",
          targets: k.targets || [],
          filter_targets: k.filter_targets || [],
          requirements: k.requirements || [],
          stacks_on_trigger: k.stacks_on_trigger || null,
          max_stacks: k.max_stacks ?? null,
          stack_duration: k.stack_duration ?? null,
          amount_func: k.amount_func || null,
          stack_func: k.stack_func || null,
          per_hero_expr: k.per_hero_expr || null,
          off_when_benched: !!k.off_when_benched
        })),
        requirements: def?.requirements || [],
        buffUpgrade: null
      };
    }
    const buffMatch = source.match(/^buff_upgrade\s*,\s*([^,]+)\s*,\s*(\d+)(?:\s*,\s*([^,]+))?/i);
    if (buffMatch) {
      const amountText = buffMatch[1].trim();
      const targetId = Number(buffMatch[2]);
      const target = upgradesById.get(targetId) || null;
      let targetEffect = null;
      let amountInterpretation = null;
      if (target && depth < 1) {
        const targetEntry = parseEffectEntry(target.effect);
        if (/^effect_def\s*,/i.test(targetEntry.command)) {
          const targetRef = Number(targetEntry.command.match(/^effect_def\s*,\s*(\d+)/i)?.[1]);
          const targetDef = effectsById.get(targetRef);
          const simpleMultiplierKey = (targetDef?.effect_keys || []).find(k =>
            /^(hero_dps_multiplier_mult|global_dps_multiplier_mult|target_hero_dps_multiplier_mult)\s*,/i.test(String(k.effect_string || "")));
          const amountMatch = String(simpleMultiplierKey?.effect_string || "").match(/^[^,]+,\s*(-?\d+(?:\.\d+)?)/);
          const baseAmount = amountMatch ? Number(amountMatch[1]) : null;
          const boostPercent = Number(amountText);
          const boostedAmount = baseAmount !== null && Number.isFinite(boostPercent)
            ? baseAmount * (1 + boostPercent / 100)
            : null;
          const inherited = boostedAmount !== null ? { amount: boostedAmount } : {};
          targetEffect = effectDetails(target.effect, upgradesById, effectsById, depth + 1, inherited);
          if (baseAmount !== null && boostedAmount !== null) {
            amountInterpretation = {
              baseAmount,
              boostPercent,
              boostedAmount,
              rule: "static_multiplier_parameter"
            };
          }
        } else if (targetEntry.command) {
          targetEffect = { source: targetEntry.command, description: targetEntry.description, effectId: null, keys: [], requirements: [], buffUpgrade: null };
        }
      }
      return {
        source,
        effectId: null,
        description: interpolateEffectText(entry.description || (target
          ? 'Усиливает улучшение #' + targetId + ' «' + (target.name || target.specialization_name || 'без названия') + '» на ' + amountText + '%'
          : 'Команда buff_upgrade с величиной ' + amountText + '%; целевое улучшение #' + targetId + ' не найдено в выгрузке.'), inheritedParams),
        keys: [],
        requirements: [],
        buffUpgrade: {
          amount: Number(amountText),
          amountText,
          targetId,
          targetName: target ? (target.name || target.specialization_name || 'без названия') : '',
          targetEffect,
          amountInterpretation,
          variant: buffMatch[3] || null
        }
      };
    }
    return {
      source,
      effectId: null,
      description: entry.description || (source ? 'Прямая игровая команда: ' + source : ''),
      keys: [],
      requirements: [],
      buffUpgrade: null
    };
  }
  function resolveSpecialization(name, tier, choiceName, upgradesById, effectsById) {
    const heroTiers = tiersFor(name);
    const tierData = heroTiers.find(t => Number(t.level) === Number(tier));
    const choice = tierData?.choices?.find(c => String(c.name || "").trim().toLowerCase() === String(choiceName || "").trim().toLowerCase());
    if (!choice) return { name: choiceName, missing: true };
    const upgrades = (choice.upgradeIds || []).map(id => upgradesById.get(Number(id))).filter(Boolean);
    const rawEffects = [];
    const seen = new Set();
    const addRaw = (raw, upgradeId) => {
      const parsed = parseEffectEntry(raw);
      if (!parsed.command) return;
      const key = parsed.command + '|' + (upgradeId ?? '');
      if (!seen.has(key)) {
        seen.add(key);
        rawEffects.push({ raw, upgradeId });
      }
    };
    for (const upgrade of upgrades) addRaw(upgrade.effect, upgrade.id);
    for (const raw of (choice.effects || [])) {
      const parsed = parseEffectEntry(raw);
      if (!rawEffects.some(item => parseEffectEntry(item.raw).command === parsed.command)) addRaw(raw, null);
    }
    const effects = rawEffects.map(item => ({
      ...effectDetails(item.raw, upgradesById, effectsById),
      upgradeId: item.upgradeId
    }));
    return { name: choiceName, upgrades, effects, missing: false };
  }
  function mechanicLabel(command) {
    const name = String(command || "").split(",")[0].trim().toLowerCase();
    const labels = {
      hero_dps_multiplier_mult: "Множитель урона самого чемпиона",
      global_dps_multiplier_mult: "Множитель урона всех чемпионов",
      target_hero_dps_multiplier_mult: "Множитель урона указанного чемпиона",
      buff_upgrade: "Усиление другого улучшения — нужно раскрыть целевой эффект",
      buff_upgrades: "Усиление нескольких улучшений — требуется разобрать каждую цель",
      hero_dps_multiplier_mult_plus_upgrade_bonus: "Множитель урона с дополнительным бонусом улучшения"
    };
    return labels[name] || "";
  }
  function renderEffectKeys(keys) {
    return (keys || []).map(key => {
      const targets = key.targets?.length ? ' · цели: ' + key.targets.join(', ') : '';
      const filters = key.filter_targets?.length ? ' · фильтры: ' + key.filter_targets.map(f => [f.type, f.tags || f.tag || ''].filter(Boolean).join(': ')).join('; ') : '';
      const conditions = key.stacks_on_trigger ? ' · триггер/накопление: ' + JSON.stringify(key.stacks_on_trigger) : '';
      const extra = [
        key.amount_func ? 'amount_func=' + key.amount_func : '',
        key.stack_func ? 'stack_func=' + key.stack_func : '',
        key.per_hero_expr ? 'условие героя=' + key.per_hero_expr : '',
        key.off_when_benched ? 'не действует, когда чемпион не в строю' : '',
        key.max_stacks != null ? 'макс. накоплений=' + key.max_stacks : '',
        key.stack_duration != null ? 'длительность накопления=' + key.stack_duration : ''
      ].filter(Boolean).join(' · ');
      const label = mechanicLabel(key.effect_string);
      return '<div class="muted" style="margin-left:12px"><div>Ключ: <code>' + esc(key.effect_string) + '</code>' +
        (label ? ' — ' + esc(label) : '') + '</div><div>' + esc(targets + filters + conditions) + '</div>' +
        (extra ? '<div>' + esc(extra) + '</div>' : '') +
        (key.requirements?.length ? '<div>Требования: <code>' + esc(JSON.stringify(key.requirements)) + '</code></div>' : '') +
        '</div>';
    }).join("");
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
            const keys = renderEffectKeys(effect.keys);
            const buff = effect.buffUpgrade;
            const targetKeys = buff?.targetEffect ? renderEffectKeys(buff.targetEffect.keys) : '';
            const buffDetail = buff
              ? '<div class="muted" style="margin-left:12px">Цель buff_upgrade: #' + buff.targetId + (buff.targetName ? ' «' + esc(buff.targetName) + '»' : '') +
                ' · величина: ' + esc(buff.amountText) + '%' +
                (buff.amountInterpretation ? ' · параметр эффекта: ' + esc(buff.amountInterpretation.baseAmount) + '% → ' + esc(buff.amountInterpretation.boostedAmount) + '%' : '') +
                (buff.variant ? ' · параметр: ' + esc(buff.variant) : '') + '</div>' +
                (buff.targetEffect ? '<div style="margin-left:24px"><div>Эффект целевого улучшения: ' + esc(buff.targetEffect.description || 'описание отсутствует') + '</div>' +
                  '<div class="muted">Команда цели: <code>' + esc(buff.targetEffect.source || '') + '</code>' +
                  (buff.targetEffect.effectId ? ' · effect_def #' + buff.targetEffect.effectId : '') + '</div>' + targetKeys + '</div>' : '')
              : '';
            const reqs = effect.requirements?.length
              ? '<div class="muted" style="margin-left:12px">Условия эффекта: <code>' + esc(JSON.stringify(effect.requirements)) + '</code></div>'
              : '';
            return '<div style="margin:4px 0 8px 12px"><div>' + esc(effect.description || 'Описание эффекта отсутствует в выгрузке.') + '</div>' +
              '<div class="muted">Источник: <code>' + esc(effect.source) + '</code>' + (effect.effectId ? ' · effect_def #' + effect.effectId : '') +
              (effect.upgradeId ? ' · улучшение #' + effect.upgradeId : '') + '</div>' + buffDetail + keys + reqs + '</div>';
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