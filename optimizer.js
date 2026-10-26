/* Idle Champions Helper — автоподбор состава и специализаций.
 * Подключать ПОСЛЕ simulator.js:  <script src="./optimizer.js"></script>
 *
 * Модель — относительная эвристика, а не реальный DPS: роли чемпионов +
 * позиционные правила + разбор текста описаний специализаций (кого усиливает:
 * позади / в ряду / рядом / всех). Числа множителей не выдумываются.
 * Поиск: имитация отжига по расстановке и выбору специализаций на всех уровнях.
 */
(() => {
  "use strict";
  const anchor = document.getElementById("autoPick");
  if (!anchor || typeof formation === "undefined") return;

  // Веса целей: что считается ценным для выбранной цели формации.
  const GOALS = {
    balanced: { dps: 1.0, support: 0.8, tank: 0.6, heal: 0.2, debuff: 0.3, speed: 0.3, gold: 0.3 },
    push:     { dps: 1.4, support: 0.9, tank: 0.9, heal: 0.4, debuff: 0.5, speed: 0.1, gold: 0.0 },
    speed:    { dps: 0.6, support: 0.6, tank: 0.4, heal: 0.1, debuff: 0.1, speed: 1.6, gold: 0.1 },
    gold:     { dps: 0.4, support: 0.5, tank: 0.3, heal: 0.1, debuff: 0.2, speed: 0.2, gold: 1.6 }
  };
  const SCOPE_LABEL = { behind: "позади", row: "в своём ряду", adj: "рядом", all: "всех" };
  const KIND_LABEL = { dmg: "урон", gold: "золото", speed: "скорость", def: "живучесть" };

  // Разбор русских описаний специализаций (ё→е, \b для кириллицы не используем).
  const RX = {
    behind: /позади|за собой|за ним|за ней|за ними|сзади/,
    row: /в (своем|его|ее|том же|одном|этом) ряду|в ряду/,
    adj: /рядом|соседн|окружа|смежн/,
    all: /всех (воител|чемпион|союзник)|всем (воител|чемпион|союзник)|всей (формаци|команд|групп)|вся (формаци|команд)/,
    boost: /повыш|усил|увелич|бонус|добавл|ускор|улучш|помога/,
    dmg: /урон|атак/, gold: /золот/, speed: /скорост|ускор|спринт|быстр/,
    def: /лечен|исцел|выживаем|щит|защит|здоровь/
  };
  const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
  function parseSpec(desc) {
    const d = norm(desc), kinds = [];
    if (RX.boost.test(d)) for (const k of ["dmg", "gold", "speed", "def"]) if (RX[k].test(d)) kinds.push(k);
    let scope = null;
    for (const k of ["behind", "row", "adj", "all"]) if (RX[k].test(d)) { scope = k; break; }
    return { kinds, scope };
  }

  const tiersOf = (n) =>
    specializationTiers[n] || specializationTiersByLowerName[String(n).trim().toLowerCase()] || [];
  const metaOf = (n) =>
    champions.find((c) => c.name.toLowerCase() === n.toLowerCase()) || { name: n, roles: [], seat: 0 };

  function makeInfo(name) {
    const meta = metaOf(name), has = (r) => meta.roles.includes(r);
    const tiers = tiersOf(name).filter((t) => t.choices && t.choices.length);
    return {
      meta,
      base: {
        dps: has("DPS") ? 1.5 : 0, support: has("Support") ? 1 : 0, tank: has("Tank") ? 1 : 0,
        heal: has("Healing") ? 1 : 0, debuff: has("Debuff") || has("Control") ? 1 : 0,
        speed: has("Speed") ? 1 : 0, gold: has("Gold") ? 1 : 0
      },
      levels: tiers.map((t) => t.level),
      tiers: tiers.map((t) => t.choices.map((c) => ({ name: c.name, parsed: parseSpec(c.description) })))
    };
  }
  // Профиль чемпиона = роли + личные бонусы выбранных специализаций.
  function profileOf(info, picks) {
    const p = { ...info.base };
    info.tiers.forEach((tier, ti) => {
      const sp = tier[picks[ti]]; if (!sp) return;
      const { scope, kinds } = sp.parsed;
      if (scope) { p.support += 0.3; return; }
      if (kinds.includes("dmg")) p.dps += 0.5;
      if (kinds.includes("gold")) p.gold += 0.5;
      if (kinds.includes("speed")) p.speed += 0.5;
      if (kinds.includes("def")) { p.tank += 0.3; p.heal += 0.2; }
    });
    return p;
  }
  const kindWeight = (G, k) => k === "dmg" ? G.dps : k === "gold" ? G.gold : k === "speed" ? G.speed : G.tank * 0.6 + G.heal;
  function matches(scope, ps, pt) {
    if (scope === "all") return true;
    if (scope === "row") return ps.row === pt.row;
    return relationMatches({ relation: scope === "adj" ? "adjacent" : "behind" }, ps, pt);
  }

  function evaluate(st, ctx, explain) {
    const { pos, G, infos, front } = ctx, who = [], notes = {};
    let score = 0;
    st.slots.forEach((n, i) => {
      if (!n) return;
      const info = infos.get(n), prof = profileOf(info, st.picks[n]);
      who.push({ n, i, info, prof });
      for (const k in G) score += prof[k] * G[k] * 10;
      if (pos[i].row === front) score += prof.tank * G.tank * 5;
    });
    for (const s of who) {
      const add = (txt) => { if (explain) (notes[s.n] = notes[s.n] || []).push(txt); };
      s.info.tiers.forEach((tier, ti) => {
        const sp = tier[st.picks[s.n][ti]];
        if (!sp || !sp.parsed.scope || !sp.parsed.kinds.length) return;
        const f = sp.parsed.scope === "all" ? 0.6 : 1, hit = [];
        for (const t of who) {
          if (t === s || !matches(sp.parsed.scope, pos[s.i], pos[t.i])) continue;
          hit.push(t.n);
          for (const k of sp.parsed.kinds)
            score += f * kindWeight(G, k) * 6 * (1 + (k === "dmg" ? t.prof.dps : 0.3));
        }
        if (hit.length) add("Ур. " + s.info.levels[ti] + " «" + sp.name + "»: " +
          sp.parsed.kinds.map((k) => KIND_LABEL[k]).join("/") + " " + SCOPE_LABEL[sp.parsed.scope] +
          " → " + hit.join(", "));
      });
      const rule = positionalRules[s.n];
      if (rule) {
        const hit = [];
        for (const t of who) if (t !== s && relationMatches(rule, pos[s.i], pos[t.i])) {
          hit.push(t.n); score += G.dps * 6 * (1 + t.prof.dps);
        }
        if (hit.length) add(rule.label + " → " + hit.join(", "));
      }
    }
    return explain ? { score, notes } : score;
  }

  function mulberry(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clone = (st) => ({ slots: st.slots.slice(), picks: Object.fromEntries(Object.entries(st.picks).map(([k, v]) => [k, v.slice()])) });

  function optimize(ctx, pool, seed) {
    const rnd = mulberry(seed), { infos, pos } = ctx, total = pos.length;
    const rint = (n) => Math.floor(rnd() * n);
    const picks = {};
    for (const n of pool) {   // старт: лучшая «личная» специализация на каждом уровне
      const info = infos.get(n);
      picks[n] = info.tiers.map((tier) => {
        let bi = 0, bv = -1;
        tier.forEach((sp, ci) => {
          const v = profileOf({ ...info, tiers: [[sp]] }, [0]);
          const val = v.dps + v.gold + v.speed + v.tank + rnd() * 0.3;
          if (val > bv) { bv = val; bi = ci; }
        });
        return bi;
      });
    }
    const own = (n) => { const p = profileOf(infos.get(n), picks[n]); let s = 0; for (const k in ctx.G) s += p[k] * ctx.G[k]; return s; };
    const seats = new Set(), slots = Array(total).fill("");
    let fill = 0;
    for (const n of [...pool].sort((a, b) => own(b) - own(a))) {
      if (fill >= total) break;
      const seat = infos.get(n).meta.seat;
      if (seat && seats.has(seat)) continue;
      if (seat) seats.add(seat);
      slots[fill++] = n;
    }
    const st = { slots, picks };
    let cur = evaluate(st, ctx), best = cur, bestSt = clone(st);
    const N = 12000;
    for (let it = 0; it < N; it++) {
      const T = 8 * (1 - it / N) + 0.05, r = rnd();
      let undo;
      if (r < 0.4) {
        const a = rint(total), b = rint(total);
        if (a === b || (!st.slots[a] && !st.slots[b])) continue;
        const sw = () => { [st.slots[a], st.slots[b]] = [st.slots[b], st.slots[a]]; };
        sw(); undo = sw;
      } else if (r < 0.75) {
        const i = rint(total), cand = pool[rint(pool.length)];
        if (st.slots.includes(cand)) continue;
        const seat = infos.get(cand).meta.seat;
        if (seat && st.slots.some((n, j) => j !== i && n && infos.get(n).meta.seat === seat)) continue;
        const old = st.slots[i]; st.slots[i] = cand; undo = () => { st.slots[i] = old; };
      } else {
        const filled = st.slots.filter(Boolean); if (!filled.length) continue;
        const n = filled[rint(filled.length)], info = infos.get(n);
        if (!info.tiers.length) continue;
        const ti = rint(info.tiers.length), ci = rint(info.tiers[ti].length), old = st.picks[n][ti];
        st.picks[n][ti] = ci; undo = () => { st.picks[n][ti] = old; };
      }
      const s = evaluate(st, ctx);
      if (s >= cur || rnd() < Math.exp((s - cur) / T)) {
        cur = s; if (s > best) { best = s; bestSt = clone(st); }
      } else undo();
    }
    return { st: bestSt, score: best };
  }

  function run() {
    const status = document.getElementById("optReport");
    if (!roster.length) { status.textContent = "Сначала добавь чемпионов в «Мой ростер»."; return; }
    if (!Object.keys(specializationTiers).length) { status.textContent = "База специализаций ещё грузится — повтори через секунду."; return; }
    const pos = formationPositions(), goal = document.getElementById("pickGoal").value;
    const ctx = { pos, G: GOALS[goal] || GOALS.balanced, infos: new Map(), front: Math.max(...pos.map((p) => p.row)) };
    for (const n of roster) ctx.infos.set(n, makeInfo(n));
    let res = null;
    for (const seed of [1, 2, 3]) { const r = optimize(ctx, roster.slice(), seed); if (!res || r.score > res.score) res = r; }

    formation = res.st.slots.slice();
    for (const n of formation.filter(Boolean)) {
      const info = ctx.infos.get(n);
      info.tiers.forEach((tier, ti) => {
        const name = tier[res.st.picks[n][ti]].name;
        selectedSpecs[n + "::" + info.levels[ti]] = name;
        if (ti === 0) selectedSpecs[n] = name;
      });
    }
    localStorage.setItem("icChampionSpecs", JSON.stringify(selectedSpecs));
    save(); renderForms();
    window.dispatchEvent(new Event("ic-specs-updated"));

    const { notes } = evaluate(res.st, ctx, true);
    const rows = formation.map((n, i) => {
      if (!n) return "";
      const info = ctx.infos.get(n);
      const specs = info.tiers.map((t, ti) => "ур. " + info.levels[ti] + ": «" + esc(t[res.st.picks[n][ti]].name) + "»").join("; ");
      return "<li><b>Слот " + (i + 1) + " · " + esc(n) + "</b>" + (specs ? " — " + specs : "") +
        ((notes[n] || []).length ? "<br><small>" + notes[n].map(esc).join("<br>") + "</small>" : "") + "</li>";
    }).join("");
    status.innerHTML = "<b>Подбор готов</b> (цель: " + esc(document.getElementById("pickGoal").selectedOptions[0].text) +
      ", относительная оценка " + res.score.toFixed(1) + ").<ul style='margin:6px 0;padding-left:20px'>" + rows +
      "</ul><small>Это эвристика по ролям, позициям и тексту описаний, а не расчёт DPS: числа эффектов (effect_def) в данных пока недоступны. Предполагается, что все уровни специализаций открыты.</small>";
  }

  const btn = document.createElement("button");
  btn.className = "primary"; btn.id = "optimize";
  btn.textContent = "🧠 Оптимизировать состав и специализации";
  btn.onclick = run;
  anchor.after(btn);
  const report = document.createElement("div");
  report.className = "status"; report.id = "optReport";
  report.textContent = "Оптимизатор подбирает чемпионов из ростера и специализации на всех уровнях под выбранную цель.";
  document.getElementById("synergyStatus").after(report);
})();
