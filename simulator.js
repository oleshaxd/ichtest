/* Idle Champions Helper — shared DPS/BUD simulator UI and data foundation.
 * The main page uses the live formation; the standalone page remains available for testing.
 * Unknown game mechanics are never replaced with guessed numbers.
 */
(() => {
  "use strict";
  const DATA_URL = "./data/simulator-champions.json";
  const $ = (id) => document.getElementById(id);
  if (!$("roster") || !$("selected")) return;

  const embedded = !!$("simScope");
  let roster = [];
  let formation = [];
  let formType = "diamond";
  let data = null;
  let selected = [];
  let specs = {};

  function safeParse(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }
  function readSources() {
    roster = safeParse(localStorage.getItem("icRoster"), []);
    formation = safeParse(localStorage.getItem("icFormation"), []);
    formType = localStorage.getItem("icFormType") || "diamond";
  }
  function availableNames() {
    const placed = [...new Set(formation.filter(Boolean))];
    if (!embedded || $("simScope").value === "roster") return [...new Set(roster)];
    return placed;
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
  function championRecord(name) { return data?.champions?.[name] || null; }

  function renderRoster() {
    const box = $("roster");
    const names = availableNames();
    if (!names.length) {
      box.innerHTML = embedded && $("simScope").value === "formation"
        ? '<p class="muted">Формация пока пустая. Поставь чемпионов в слоты выше или переключи анализ на весь ростер.</p>'
        : '<p class="muted">В локальном ростере нет чемпионов. Сначала добавь их на основной странице.</p>';
      return;
    }
    box.innerHTML = names.map((name) => {
      const checked = selected.includes(name) ? "checked" : "";
      const record = championRecord(name);
      const slot = slotOf(name);
      const placement = embedded && $("simScope").value === "formation" && slot
        ? `Слот ${slot} · ` : "";
      return `<label class="roster-item">
        <input type="checkbox" data-champion="${esc(name)}" ${checked}>
        <span><strong>${esc(name)}</strong><small>${placement}${record ? "Есть запись в базе" : "Механики не проверены"}</small></span>
      </label>`;
    }).join("");
    box.querySelectorAll("[data-champion]").forEach((input) => {
      input.addEventListener("change", () => {
        const name = input.dataset.champion;
        if (input.checked) {
          if (!selected.includes(name)) selected.push(name);
        } else {
          selected = selected.filter((item) => item !== name);
          delete specs[name];
        }
        renderRoster();
        renderSelected();
        renderResults();
      });
    });
  }

  function renderSelected() {
    const box = $("selected");
    if (!selected.length) {
      box.innerHTML = '<p class="muted">Выбери чемпионов для анализа слева.</p>';
      return;
    }
    box.innerHTML = selected.map((name) => {
      const record = championRecord(name);
      const options = Array.isArray(record?.specializations) ? record.specializations : [];
      const current = specs[name] || "";
      const slot = slotOf(name);
      const position = embedded && slot ? `<small class="muted">Позиция в текущей формации: слот ${slot}</small>` : "";
      const specControl = options.length
        ? `<label class="field">Специализация<select data-spec="${esc(name)}">
            <option value="">— выбрать —</option>
            ${options.map((spec) => `<option value="${esc(spec.id)}" ${current === spec.id ? "selected" : ""}>${esc(spec.name)}</option>`).join("")}
          </select></label>`
        : '<p class="warning">Нет подтверждённых данных специализаций для этого чемпиона.</p>';
      return `<article class="champion">
        <div class="champion-title"><strong>${esc(name)}</strong><button type="button" class="remove" data-remove="${esc(name)}">Убрать</button></div>
        ${position}
        ${specControl}
        <small>${record?.dataStatus === "verified" ? "Данные проверены" : "Данные способностей не подтверждены"}</small>
      </article>`;
    }).join("");
    box.querySelectorAll("[data-spec]").forEach((select) => {
      select.addEventListener("change", () => {
        specs[select.dataset.spec] = select.value;
        renderResults();
      });
    });
    box.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.dataset.remove;
        selected = selected.filter((item) => item !== name);
        delete specs[name];
        renderRoster();
        renderSelected();
        renderResults();
      });
    });
  }

  function getVerifiedData() {
    return selected.map((name) => ({ name, record: championRecord(name), specId: specs[name] }))
      .filter((item) => item.record?.dataStatus === "verified" &&
        item.record?.specializations?.some((spec) => spec.id === item.specId) &&
        Array.isArray(item.record?.effects) && item.record.effects.length > 0);
  }
  function renderResults() {
    const verified = getVerifiedData();
    const missing = selected.length - verified.length;
    $("coverage").textContent = `Выбрано чемпионов: ${selected.length}. Полностью проверенных записей с выбранной специализацией и числовыми эффектами: ${verified.length}.`;
    $("dps").textContent = "Не рассчитан";
    $("bud").textContent = "Не рассчитан";
    $("resultNote").innerHTML = selected.length
      ? `Это пока интерфейс и база для модели, не готовый боевой расчёт. Полных проверенных записей: <b>${verified.length}</b>. Без подтверждённых формул атак, усилений и позиционных условий достоверный DPS/BUD вычислить нельзя.${missing ? ` Не хватает данных для ${missing} выбранных чемпионов.` : ""}`
      : "Добавь чемпионов в формацию или выбери весь ростер.";
    $("effectList").innerHTML = verified.length
      ? verified.flatMap(({ name, record, specId }) => record.effects
          .filter((effect) => effect.specializationId === specId)
          .map((effect) => `<li><b>${esc(name)}</b>: ${esc(effect.description || effect.id)} — ${esc(effect.value)} (${esc(effect.operation)})</li>`))
          .join("") || "<li>Нет числовых эффектов для выбранных специализаций.</li>"
      : "<li>Пока нет подтверждённых записей. Неизвестные значения не заменяются догадками.</li>";
  }

  function refreshFromMain(resetSelection = true) {
    readSources();
    const names = availableNames();
    if (resetSelection) selected = names.slice();
    else selected = selected.filter((name) => names.includes(name));
    for (const key of Object.keys(specs)) if (!names.includes(key)) delete specs[key];
    if (embedded) {
      const count = formation.filter(Boolean).length;
      $("sourceInfo").textContent = $("simScope").value === "formation"
        ? `Текущая формация «${formType}»: ${count} занятых слотов. Анализируются только чемпионы, стоящие в схеме выше.`
        : `Ростер: ${roster.length} чемпионов. Анализируется весь доступный список, независимо от заполнения формации.`;
    } else {
      $("sourceInfo").textContent = `Ростер прочитан из этого браузера: ${roster.length} чемпионов. Формация «${formType}»: ${formation.filter(Boolean).length} занятых слотов.`;
    }
    renderRoster();
    renderSelected();
    renderResults();
  }

  async function init() {
    readSources();
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось загрузить базу данных");
      data = await response.json();
      $("dataVersion").textContent = data.gameDataVersion || "Не задана";
    } catch (error) {
      data = { champions: {} };
      $("dataVersion").textContent = "Ошибка загрузки";
      $("resultNote").textContent = error.message;
    }
    refreshFromMain(true);
  }

  $("selectAll").addEventListener("click", () => {
    selected = availableNames();
    renderRoster(); renderSelected(); renderResults();
  });
  $("clearSelected").addEventListener("click", () => {
    selected = []; specs = {};
    renderRoster(); renderSelected(); renderResults();
  });
  if (embedded) $("simScope").addEventListener("change", () => refreshFromMain(true));
  window.addEventListener("ic-helper-updated", () => refreshFromMain(true));
  window.addEventListener("storage", (event) => {
    if (["icRoster", "icFormation", "icFormType"].includes(event.key)) refreshFromMain(true);
  });
  init();
})();
