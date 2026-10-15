'use strict';

/*
 * Deadlock (Valve): hrdinové, itemy, tier listy a buildy z deadlock-api.com – komunitní API se statistikami
 * zápasů ze hry.
 *   /v1/assets/heroes, /v1/assets/items/by-type/upgrade – jména, obrázky, ceny itemů (v jazyce appky)
 *   /v1/analytics/hero-stats            – výhry a zápasy hrdinů
 *   /v1/analytics/item-stats            – výhry, zápasy a průměrný čas nákupu itemů (pro hrdinu)
 *   /v1/builds                          – buildy hráčů ze hry, nejoblíbenější nahoře
 * Stránky #/dl (hrdinové), #/dl/hero/<jméno> a #/dl/items. Hrdina, za kterého hraješ („Hraju za…“),
 * jde do desktopové appky: overlay s pořadím nákupu a tierem každého itemu.
 * Používá pomocné funkce z app.js (esc, pct, view, state…) – volá se až po jeho načtení.
 */
const Deadlock = (() => {
  const BASE = 'https://api.deadlock-api.com';
  const LANGS = { cs: 'czech', sk: 'czech', en: 'english', de: 'german', pl: 'polish' };
  const lang = () => LANGS[I18N.code] || 'english';
  const DAYS = 7;          // statistiky za posledních 7 dní
  const MIN_PICK = 0.01;   // hrdina pod 1 % zápasů nemá tier (stejně jako málo hraní šampioni v LoL)
  const PLAYERS = 12;      // 6 na 6

  // Minimální rank zápasů – badge = rank × 10 + podúroveň 1–6 (/v1/assets/ranks), názvy ranků jsou ze hry
  const RANKS = [
    { key: 'all', badge: 0 },
    { key: 'acolyte', badge: 31, name: { en: 'Acolyte', cs: 'Akolyta', de: 'Akolyth', pl: 'Akolita' } },
    { key: 'sentinel', badge: 41, name: { en: 'Sentinel', cs: 'Sentinel', de: 'Wächter', pl: 'Konstabl' } },
    { key: 'mystic', badge: 51, name: { en: 'Mystic', cs: 'Mystik', de: 'Mystiker', pl: 'Mistyk' } },
    { key: 'ritualist', badge: 61, name: { en: 'Ritualist', cs: 'Obřadník', de: 'Ritualist', pl: 'Rytualista' } },
    { key: 'emissary', badge: 71, name: { en: 'Emissary', cs: 'Vyslanec', de: 'Emissär', pl: 'Emisariusz' } },
    { key: 'oracle', badge: 81, name: { en: 'Oracle', cs: 'Prorok', de: 'Orakel', pl: 'Wieszcz' } },
    { key: 'phantom', badge: 91, name: { en: 'Phantom', cs: 'Fantóm', de: 'Phantom', pl: 'Fantom' } },
    { key: 'ascendant', badge: 101, name: { en: 'Ascendant', cs: 'Nadčlověk', de: 'Aszendent', pl: 'Wyniesiony' } },
    { key: 'eternus', badge: 111, name: { en: 'Eternus', cs: 'Eternus', de: 'Ewiger', pl: 'Eternus' } },
  ];
  const rankByKey = k => RANKS.find(r => r.key === k) || RANKS[0];
  const rankLabel = r => {
    if (!r.badge) return t('dl.rankAll');
    const name = r.name[I18N.code === 'sk' ? 'cs' : I18N.code] || r.name.en;
    return r.key === 'eternus' ? name : `${name}+`;
  };

  // Barvy a názvy typů itemů ve hře: zbraň (oranžová), vitalita (zelená), duch (fialová)
  const SLOTS = ['weapon', 'vitality', 'spirit'];
  const slotLabel = s => t(`dl.slot.${s}`);

  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  const strip = s => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  // Jména v češtině a polštině mají na začátku gramatický rod pro hru („#|ma|#Infernus“)
  const cleanName = s => strip(s).replace(/^#\|[^|]*\|#/, '').trim();
  const dayAgo = days => Math.floor(Date.now() / 86400000 - days) * 86400; // začátek dne (UTC) – adresa se mění jednou denně
  const since = () => dayAgo(DAYS);
  const rankQ = badge => (badge ? `&min_average_badge=${badge}` : '');

  // ---------- Stahování ----------

  // Posledních pár odpovědí v paměti (statistiky itemů jsou pro každého hrdinu zvlášť)
  const cache = new Map();
  function getJSON(url) {
    let p = cache.get(url);
    if (p) {
      cache.delete(url);
      cache.set(url, p);
      return p;
    }
    p = fetch(url).catch(() => fetch(url, { cache: 'reload' })).then(r => {
      const offline = r.headers.get('X-NotLoL-Offline');
      if (offline) window.dispatchEvent(new CustomEvent('notlol-offline', { detail: offline }));
      if (!r.ok) throw new API.HttpError(r.status, url);
      return r.json();
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
    while (cache.size > 24) cache.delete(cache.keys().next().value);
    return p;
  }

  // Data ze hry v jazyce appky; když ho API nemá, anglicky. Jen hratelní hrdinové a jen itemy z obchodu
  // (celý seznam itemů má i schopnosti a zbraně – 3× víc dat)
  const ASSETS = { heroes: 'heroes?only_active=true&', items: 'items/by-type/upgrade?' };
  const assetUrl = (what, language = lang()) => `${BASE}/v1/assets/${ASSETS[what]}language=${language}`;
  async function assetsJSON(what, language = lang()) {
    try {
      return await getJSON(assetUrl(what, language));
    } catch (err) {
      if (language === 'english') throw err;
      return getJSON(assetUrl(what, 'english'));
    }
  }

  const list = j => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : []);

  function toItem(i) {
    const name = cleanName(i.name);
    return {
      id: i.id,
      cls: i.class_name || '',
      name,
      norm: API.normalize(name),
      slot: SLOTS.includes(i.item_slot_type) ? i.item_slot_type : 'weapon',
      tier: num(i.item_tier),
      cost: num(i.cost),
      icon: i.shop_image_small || i.shop_image_webp || i.shop_image || i.image_webp || i.image || '',
      png: i.shop_image || i.image || '', // overlay (Windows) WebP nenačte
      active: !!i.is_active_item,
    };
  }
  const isShopItem = i => i && i.type === 'upgrade' && i.name && i.shopable !== false && !i.disabled;

  let assetsPromise = null;
  function getAssets() {
    assetsPromise ??= (async () => {
      const [heroJson, itemJson] = await Promise.all([assetsJSON('heroes'), assetsJSON('items')]);
      const heroes = list(heroJson)
        .filter(h => h && h.id && h.name && h.player_selectable !== false && !h.disabled && !h.in_development)
        .map(h => {
          const img = h.images || {};
          const name = cleanName(h.name);
          return {
            id: h.id,
            name,
            // Adresa stránky nezávislá na jazyku (hero_inferno → inferno)
            slug: API.normalize(String(h.class_name || '').replace(/^hero_/, '')) || API.normalize(name),
            // Hledá se i podle anglického jména („Seven“ v polštině je „Siódemka“)
            norm: `${API.normalize(name)} ${API.normalize(cleanName(h.search_name))}`,
            icon: img.icon_image_small_webp || img.icon_image_small || img.icon_hero_card_webp || img.icon_hero_card || '',
            png: img.icon_image_small || img.icon_hero_card || '', // overlay (Windows) WebP nenačte
            card: img.icon_hero_card_webp || img.icon_hero_card || img.icon_image_small_webp || img.icon_image_small || '',
            // Pozadí hrdiny (velké, jen na jeho stránce) a karta s hrdinou (malá, na stupně vítězů)
            art: img.background_image_webp || img.background_image || img.hero_card_gloat_webp || img.hero_card_gloat
              || img.icon_hero_card_webp || img.icon_hero_card || '',
            podium: img.hero_card_gloat_webp || img.hero_card_gloat || img.icon_hero_card_webp || img.icon_hero_card || '',
            role: strip(h.description?.role),
            playstyle: strip(h.description?.playstyle),
          };
        })
        .sort((a, b) => I18N.compare(a.name, b.name));
      const items = list(itemJson).filter(isShopItem).map(toItem);
      return {
        heroes,
        heroById: new Map(heroes.map(h => [h.id, h])),
        heroBySlug: new Map(heroes.map(h => [h.slug, h])),
        items,
        itemById: new Map(items.map(i => [i.id, i])),
      };
    })();
    assetsPromise.catch(() => (assetsPromise = null));
    return assetsPromise;
  }

  // Hrdinové: výhry, zápasy, KDA → tier (stejné skóre jako u šampionů v LoL)
  async function getHeroRows(rank) {
    const [a, json] = await Promise.all([
      getAssets(),
      getJSON(`${BASE}/v1/analytics/hero-stats?min_unix_timestamp=${since()}${rankQ(rank.badge)}`),
    ]);
    const raw = list(json).filter(r => a.heroById.has(r.hero_id));
    const totalGames = raw.reduce((s, r) => s + (num(r.matches) || num(r.wins) + num(r.losses)), 0) / PLAYERS;
    const rows = raw.map(r => {
      const matches = num(r.matches) || num(r.wins) + num(r.losses);
      const k = num(r.total_kills), d = num(r.total_deaths), as = num(r.total_assists);
      return {
        hero: a.heroById.get(r.hero_id),
        wins: num(r.wins),
        matches,
        wr: matches ? num(r.wins) / matches : 0,
        pickRate: totalGames ? matches / totalGames : 0,
        banRate: 0,
        kda: k || as ? (k + as) / Math.max(1, d) : null,
      };
    });
    API.scoreRole(rows, MIN_PICK);
    return { rows, totalGames: Math.round(totalGames), assets: a };
  }

  // Itemy hrdiny (nebo všech hrdinů): win rate, jak často se kupují a kdy
  async function getItemRows(heroId, rank, heroMatches) {
    const [a, json] = await Promise.all([
      getAssets(),
      getJSON(`${BASE}/v1/analytics/item-stats?${heroId ? `hero_id=${heroId}&` : ''}min_unix_timestamp=${since()}${rankQ(rank.badge)}`),
    ]);
    const raw = list(json).filter(r => a.itemById.has(r.item_id));
    const base = heroMatches || Math.max(1, ...raw.map(r => num(r.matches) || num(r.wins) + num(r.losses)));
    return raw.map(r => {
      const matches = num(r.matches) || num(r.wins) + num(r.losses);
      return {
        item: a.itemById.get(r.item_id),
        wins: num(r.wins),
        matches,
        wr: matches ? num(r.wins) / matches : 0,
        pick: Math.min(1, matches / base),
        buy: num(r.avg_buy_time_s) || null,
      };
    });
  }

  // Buildy hráčů ze hry: nejvíc „oblíbených“ z těch, které autor upravil v posledních 4 měsících (starší mají
  // itemy z dávných patchů). Anglické – nejvíc hráčů, české jsou jen výjimečně.
  const BUILDS_DAYS = 120;
  // Název části buildu: výchozí názvy jsou texty hry („#Citadel_HeroBuilds_EarlyGame“), bez názvu jen „|“ a podobně
  function buildCatName(raw, i) {
    if (raw.startsWith('#')) {
      if (/early/i.test(raw)) return t('dl.earlyGame');
      if (/mid/i.test(raw)) return t('dl.mid');
      if (/late/i.test(raw)) return t('dl.late');
    }
    return !raw.startsWith('#') && /[\p{L}\p{N}]/u.test(raw) ? raw : t('dl.buildPart', { n: i + 1 });
  }
  const buildsUrl = (heroId, recent) => `${BASE}/v1/builds?hero_id=${heroId}&sort_by=favorites&sort_direction=desc&limit=8`
    + `&only_latest=true&build_language=English${recent ? `&min_unix_timestamp=${dayAgo(BUILDS_DAYS)}` : ''}`;
  async function getBuilds(heroId) {
    let json = await getJSON(buildsUrl(heroId, true));
    if (!list(json).length) json = await getJSON(buildsUrl(heroId, false)); // nový hrdina bez čerstvých buildů
    return list(json).map(b => {
      const hb = b.hero_build || b;
      const cats = (hb.details?.mod_categories || [])
        .map(c => ({ raw: strip(c.name), ids: (c.mods || []).map(m => m.ability_id).filter(Boolean) }))
        .filter(c => c.ids.length)
        .map((c, i) => ({ name: buildCatName(c.raw, i), ids: c.ids }));
      return { name: strip(hb.name), favorites: num(b.num_favorites ?? b.favorites), cats, updated: num(hb.last_updated_timestamp) };
    }).filter(b => b.name && b.cats.length).slice(0, 4);
  }

  // ---------- Build: early / mid / late ----------

  // Fáze podle průměrného času nákupu (early do 11. minuty – lajny, mid do 25.); když ho API nedá, podle tieru
  // itemu (cena). Tier 1 se v průměru kupuje kolem 8. minuty, tier 2 kolem 15., tier 3 kolem 22., tier 4 po 30.
  function phaseOf(r) {
    if (r.buy) return r.buy <= 660 ? 'early' : r.buy <= 1500 ? 'mid' : 'late';
    return r.item.tier <= 2 ? 'early' : r.item.tier === 3 ? 'mid' : 'late';
  }

  /**
   * Doporučené itemy: v každé fázi kombinace oblíbenosti (co hráči opravdu kupují) a win rate vyhlazeného
   * k průměru hrdiny (málo her = menší váha). Win rate drahých itemů je zkreslený (kupují je hlavně vítězové
   * delších her), proto se itemy porovnávají jen v rámci fáze.
   */
  function buildPhases(rows, heroWr) {
    const minGames = Math.max(30, Math.max(0, ...rows.map(r => r.matches)) * 0.02);
    const out = { early: [], mid: [], late: [] };
    for (const r of rows) {
      r.phase = phaseOf(r);
      r.wrAdj = (r.wins + 150 * heroWr) / (r.matches + 150);
      if (r.matches >= minGames) out[r.phase].push(r);
    }
    const z = (arr, get) => {
      const m = arr.reduce((s, r) => s + get(r), 0) / (arr.length || 1);
      const sd = Math.sqrt(arr.reduce((s, r) => s + (get(r) - m) ** 2, 0) / (arr.length || 1)) || 1;
      return r => (get(r) - m) / sd;
    };
    for (const key of Object.keys(out)) {
      const arr = out[key];
      const zp = z(arr, r => Math.sqrt(r.pick)), zw = z(arr, r => r.wrAdj);
      for (const r of arr) r.score = 0.55 * zp(r) + 0.45 * zw(r);
      arr.sort((a, b) => b.score - a.score);
    }
    return out;
  }

  /**
   * Pořadí nákupu: z každé fáze nejlepší itemy z těch, které hráči hrdiny opravdu kupují (aspoň 40 % toho
   * nejkupovanějšího ve fázi – žádné výstřelky s pár hrami), seřazené podle toho, kdy se v průměru kupují.
   * Každý item dostane i tier (rating): pořadí podle skóre mezi všemi itemy hrdiny, stejné hranice jako tier
   * listy. Stejné pořadí a tiery ukazuje stránka hrdiny i overlay ve hře.
   */
  const ORDER_COUNTS = { early: 5, mid: 4, late: 4 };
  const PHASE_AT = { early: 300, mid: 1000, late: 1800 }; // náhradní čas nákupu, když ho API nedá
  function buyOrder(phases) {
    const scored = [...phases.early, ...phases.mid, ...phases.late].sort((a, b) => b.score - a.score);
    scored.forEach((r, i) => (r.rating = API.tierByPosition(i, scored.length)));
    const order = [];
    for (const [phase, count] of Object.entries(ORDER_COUNTS)) {
      const arr = phases[phase];
      const minPick = Math.max(0.1, 0.4 * Math.max(0, ...arr.map(r => r.pick)));
      const popular = arr.filter(r => r.pick >= minPick);
      // Málo dat: doplnit dalšími podle skóre
      order.push(...[...popular, ...arr.filter(r => !popular.includes(r))].slice(0, count));
    }
    const at = r => r.buy || PHASE_AT[r.phase] + r.item.tier;
    return order.sort((a, b) => at(a) - at(b));
  }

  // ---------- Hrdina, za kterého hraješ (overlay ve hře) ----------

  // Bez vybraného hrdiny (nebo když ho API nezná) itemy všech hrdinů – overlay funguje i tak
  async function inGamePayload(heroId) {
    const rank = rankByKey(state.dlRank);
    const { rows: heroRows, assets } = await getHeroRows(rank);
    const hero = heroId ? assets.heroById.get(heroId) : null;
    const heroRow = hero ? heroRows.find(r => r.hero.id === hero.id) : null;
    const base = hero ? heroRow?.matches : heroRows.reduce((s, r) => s + r.matches, 0);
    const rows = await getItemRows(hero ? hero.id : null, rank, base).catch(() => []);
    const order = buyOrder(buildPhases(rows, heroRow?.wr || 0.5));
    // Krok, ikona, typ itemu (barva rámečku), cena a tier
    const pic = (r, i) => ({
      id: r.item.id, name: r.item.name, icon: r.item.png, rarity: r.item.slot, step: i + 1,
      note: r.item.cost ? nfInt.format(r.item.cost) : '', tier: r.rating?.key || '', cls: r.rating?.cls || '',
    });
    return {
      build: {
        champion: hero ? { name: hero.name, icon: hero.png } : { name: t('dl.ov.anyHero'), icon: '' },
        subtitle: hero ? `${t('dl.order')} · ${rankLabel(rank)}` : t('dl.ov.pickHero'),
        lists: Object.keys(ORDER_COUNTS).map(phase => ({
          label: t(`dl.ov.${phase}`),
          phase,
          items: order.map(pic).filter((p, i) => order[i].phase === phase),
        })).filter(l => l.items.length),
      },
    };
  }

  // Pošle desktopové appce pořadí nákupu pro hrdinu, za kterého hraješ
  let pushReq = 0;
  async function pushInGame() {
    if (!window.chrome?.webview) return;
    const id = ++pushReq;
    const payload = await inGamePayload(state.dlHero).catch(() => ({ build: null }));
    if (id === pushReq) window.chrome.webview.postMessage({ type: 'deadlockBuild', ...payload });
  }

  function setPlaying(heroId) {
    state.dlHero = heroId || null;
    savePrefs();
    pushInGame();
  }

  // ---------- Společné kousky stránek ----------

  const heroHref = h => `#/dl/hero/${encodeURIComponent(h.slug)}`;
  const itemImg = (it, cls = 'dl-ico') => `<img class="${cls} slot-${it.slot}" src="${it.icon}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
  const souls = n => (n ? `<span class="souls">${nfInt.format(n)}</span>` : '');

  function rankSelect() {
    return `<label class="select"><span>${t('f.rank')}</span><select id="dlRank">${RANKS.map(r =>
      `<option value="${r.key}" ${state.dlRank === r.key ? 'selected' : ''}>${esc(rankLabel(r))}</option>`).join('')}</select></label>`;
  }
  function bindRank(onChange) {
    $('#dlRank')?.addEventListener('change', e => {
      state.dlRank = e.target.value;
      savePrefs();
      onChange();
      pushInGame(); // build pro overlay podle nového ranku
    });
  }

  function tabsHtml(active) {
    return `<div class="mode-switch" role="tablist">
      <a class="mode-btn ${active === 'heroes' ? 'on' : ''}" href="#/dl">${icon('users', 16)}<span>${t('dl.tab.heroes')}</span></a>
      <a class="mode-btn ${active === 'items' ? 'on' : ''}" href="#/dl/items">${icon('grid', 16)}<span>${t('dl.tab.items')}</span></a>
    </div>`;
  }

  // Pruh „Hraješ za…“ (jen v desktopové appce)
  function playingBanner(a) {
    if (!window.chrome?.webview) return '';
    const hero = state.dlHero && a?.heroById.get(state.dlHero);
    return hero
      ? `<div class="banner info dl-playing">${hero.icon ? `<img src="${hero.icon}" alt="">` : icon('gamepad', 18)}
          <p>${t('dl.playing', { hero: `<b>${esc(hero.name)}</b>` })}</p>
          <a class="btn ghost small" href="${heroHref(hero)}">${t('dl.showBuild')}</a>
          <button class="btn ghost small" data-dl-stop>${t('dl.stopPlaying')}</button></div>`
      : `<div class="banner info dl-playing">${icon('gamepad', 18)}<p>${t('dl.pickHero')}</p></div>`;
  }
  function bindPlaying(rerender) {
    view.querySelector('[data-dl-stop]')?.addEventListener('click', () => {
      setPlaying(null);
      rerender();
    });
  }

  // ---------- Tier list hrdinů ----------

  let filter = '';
  let req = 0;

  function renderTier() {
    Players.setNav('dl-heroes');
    document.title = `${t('dl.title')} – NotLoL`;
    view.innerHTML = `
    <section class="page dl-page">
      <div class="page-head">
        <div><h1>${t('dl.title')}</h1><p class="sub" id="dlSub">&nbsp;</p></div>
        <div class="seg" role="group" aria-label="${esc(t('tier.view'))}">
          <button data-layout="table" class="${state.layout === 'table' ? 'on' : ''}">${icon('table', 15)}${t('tier.table')}</button>
          <button data-layout="grid" class="${state.layout === 'grid' ? 'on' : ''}">${icon('grid', 15)}${t('tier.grid')}</button>
        </div>
      </div>
      ${tabsHtml('heroes')}
      <div id="dlPlaying"></div>
      <div class="filters">
        <div class="filter-row">
          <div class="selects">${rankSelect()}</div>
          <label class="filter-search">${icon('search', 16)}
            <input id="dlSearch" class="input" type="search" placeholder="${esc(t('dl.filterHeroes'))}" value="${esc(filter)}"></label>
        </div>
      </div>
      <div id="podium"></div>
      <div id="dlBody">${loadingBlock(t('loading.data'))}</div>
    </section>`;

    view.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
      state.layout = b.dataset.layout;
      savePrefs();
      view.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
      paintTier();
    }));
    $('#dlSearch').addEventListener('input', e => {
      filter = e.target.value;
      paintTier();
    });
    bindRank(loadTier);
    loadTier();
  }

  let tierData = null;
  async function loadTier() {
    const id = ++req;
    const rank = rankByKey(state.dlRank);
    try {
      const data = await getHeroRows(rank);
      if (id !== req) return;
      tierData = { ...data, rank };
      const playing = $('#dlPlaying');
      if (playing) {
        playing.innerHTML = playingBanner(data.assets);
        bindPlaying(() => (playing.innerHTML = playingBanner(data.assets)));
      }
      paintTier();
    } catch (err) {
      if (id !== req) return;
      const body = $('#dlBody');
      if (body) body.innerHTML = errorBlock(err);
    }
  }

  function paintTier() {
    const body = $('#dlBody');
    if (!body || !tierData) return;
    const { rows: all, totalGames, rank } = tierData;
    $('#dlSub').textContent = [rankLabel(rank), t('dl.lastDays', { n: DAYS }), totalGames ? games(totalGames) : null, 'deadlock-api.com']
      .filter(Boolean).join(' · ');
    const needle = API.normalize(filter);
    const rows = all.filter(r => r.eligible && (!needle || r.hero.norm.includes(needle))).sort((a, b) => b.z - a.z);
    rows.forEach((r, i) => (r.pos = i + 1));

    $('#podium').innerHTML = needle || rows.length < 3 ? '' : `<div class="podium">${rows.slice(0, 3).map((r, i) => `
      <a class="podium-card p${i + 1}" href="${heroHref(r.hero)}" style="--splash:url('${r.hero.podium}')">
        <span class="podium-rank">${i + 1}</span>
        <img class="podium-icon" src="${r.hero.icon}" alt="">
        <span class="podium-text"><b>${esc(r.hero.name)}</b><span class="podium-meta">${tierBadge(r.tier)}</span></span>
        <span class="podium-stat"><b class="${wrClass(r.wr)}">${pct(r.wr)}</b><small>${t('col.wr')}</small></span>
      </a>`).join('')}</div>`;

    if (!rows.length) {
      body.innerHTML = `<div class="state"><p>${t('dl.empty')}</p></div>`;
      return;
    }
    if (state.layout === 'grid') {
      const groups = API.TIERS.map(tier => ({ tier, rows: rows.filter(r => r.tier === tier) }));
      body.innerHTML = `<div class="tier-grid">${groups.map(g => `
        <div class="tier-line tl-${g.tier.cls}">
          <div class="tier-label t-${g.tier.cls}">${g.tier.key}</div>
          <div class="tier-champs">${g.rows.map(r => `
            <a class="tile" href="${heroHref(r.hero)}" title="${esc(r.hero.name)} · ${esc(t('tip.wr', { label: 'WR', wr: pct(r.wr), pr: pct(r.pickRate) }))}">
              <img src="${r.hero.icon}" alt="${esc(r.hero.name)}" loading="lazy">
              <span class="tile-wr ${wrClass(r.wr)}">${nf1.format(r.wr * 100)}</span>
            </a>`).join('') || '<span class="muted">—</span>'}</div>
        </div>`).join('')}</div>`;
      return;
    }
    body.innerHTML = `<div class="table-wrap"><table class="tier-table">
      <thead><tr>
        <th class="c-pos">#</th><th class="c-champ">${t('dl.col.hero')}</th><th class="c-tier">${t('col.tier')}</th>
        <th class="num">${t('col.wr')}</th><th class="num">${t('col.pick')}</th><th class="num c-kda">${t('col.kda')}</th>
        <th class="num c-games">${t('col.games')}</th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr data-href="${heroHref(r.hero)}">
          <td class="c-pos">${r.pos}</td>
          <td class="c-champ"><a href="${heroHref(r.hero)}"><img src="${r.hero.icon}" alt="" loading="lazy"><span>${esc(r.hero.name)}</span></a></td>
          <td class="c-tier">${tierBadge(r.tier)}</td>
          <td class="num ${wrClass(r.wr)}"><b>${pct(r.wr)}</b></td>
          <td class="num">${pct(r.pickRate)}</td>
          <td class="num c-kda">${r.kda == null ? '–' : nf2.format(r.kda)}</td>
          <td class="num c-games">${nfInt.format(r.matches)}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="note">${t('dl.tierNote')}</p>`;
    body.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', e => {
      if (!e.target.closest('a')) location.hash = tr.dataset.href;
    }));
  }

  // ---------- Hrdina: build ----------

  function itemCards(rows, max) {
    if (!rows.length) return `<p class="muted">${t('dl.fewData')}</p>`;
    return `<div class="dl-items">${rows.slice(0, max).map((r, i) => `
      <div class="dl-item slot-${r.item.slot}" title="${esc(r.item.name)} · ${esc(slotLabel(r.item.slot))}">
        <span class="dl-rank">${i + 1}</span>
        ${itemImg(r.item)}
        <span class="dl-item-text">
          <b>${esc(r.item.name)}</b>
          <small>${souls(r.item.cost)}${r.buy ? ` · ${t('dl.boughtAt', { m: Math.round(r.buy / 60) })}` : ''}</small>
        </span>
        <span class="dl-item-stat"><b class="${wrClass(r.wr)}">${pct(r.wr)}</b><small>${t('dl.buys', { p: pct(r.pick) })}</small></span>
      </div>`).join('')}</div>`;
  }

  // Pořadí nákupu po fázích; čísla jdou napříč fázemi (stejná jako v overlayi), u každého itemu tier
  function orderHtml(order) {
    if (!order.length) return `<p class="muted">${t('dl.fewData')}</p>`;
    const head = { early: 'dl.earlyGame', mid: 'dl.mid', late: 'dl.late' };
    return `<div class="dl-order">${Object.keys(ORDER_COUNTS).map(phase => {
      const steps = order.map((r, i) => [r, i + 1]).filter(([r]) => r.phase === phase);
      if (!steps.length) return '';
      return `<div class="dl-order-col phase-${phase}"><h3>${t(head[phase])}</h3><div class="dl-items">${steps.map(([r, n]) => `
        <div class="dl-item slot-${r.item.slot}" title="${esc(r.item.name)} · ${esc(slotLabel(r.item.slot))}">
          <span class="dl-step">${n}</span>
          ${itemImg(r.item)}
          <span class="dl-item-text">
            <b>${esc(r.item.name)}</b>
            <small>${souls(r.item.cost)}${r.buy ? ` · ${t('dl.boughtAt', { m: Math.round(r.buy / 60) })}` : ''}</small>
          </span>
          ${tierBadge(r.rating)}
          <span class="dl-item-stat"><b class="${wrClass(r.wr)}">${pct(r.wr)}</b><small>${t('dl.buys', { p: pct(r.pick) })}</small></span>
        </div>`).join('')}</div></div>`;
    }).join('')}</div>`;
  }

  function buildsHtml(builds, a) {
    if (!builds.length) return `<p class="muted">${t('dl.noBuilds')}</p>`;
    return `<div class="dl-builds">${builds.map(b => `
      <div class="dl-build">
        <div class="dl-build-head"><b>${esc(b.name)}</b><small>${icon('star', 13)}${nfInt.format(b.favorites)}</small></div>
        ${b.cats.slice(0, 4).map(c => `
          <div class="dl-build-cat"><small>${esc(c.name)}</small>
            <div class="icon-row">${c.ids.map(id => a.itemById.get(id)).filter(Boolean).map(it =>
              `<span title="${esc(it.name)}">${itemImg(it, 'dl-ico sm')}</span>`).join('')}</div></div>`).join('')}
      </div>`).join('')}</div>`;
  }

  let heroReq = 0;
  async function renderHero(slug) {
    Players.setNav('dl-heroes');
    const id = ++heroReq;
    view.innerHTML = loadingBlock(t('loading.data'));
    try {
      const rank = rankByKey(state.dlRank);
      const { rows: heroRows, assets: a, totalGames } = await getHeroRows(rank);
      const hero = a.heroBySlug.get(slug);
      if (!hero) {
        view.innerHTML = `<div class="state error"><p>${esc(t('dl.notFound', { slug }))}</p><a class="btn" href="#/dl">${t('dl.title')}</a></div>`;
        return;
      }
      document.title = `${hero.name} – NotLoL`;
      const row = heroRows.find(r => r.hero.id === hero.id);
      const [items, builds] = await Promise.all([
        getItemRows(hero.id, rank, row?.matches).catch(() => []),
        getBuilds(hero.id).catch(() => []),
      ]);
      if (id !== heroReq) return;
      const phases = buildPhases(items, row?.wr || 0.5);
      const order = buyOrder(phases);

      const stat = (value, label, cls = '') => `<div class="stat"><b class="${cls}">${value}</b><span>${label}</span></div>`;
      const ranked = heroRows.filter(r => r.eligible).sort((x, y) => y.z - x.z);
      const pos = row ? ranked.indexOf(row) + 1 : 0;
      const stats = row ? [
        `<div class="stat stat-tier">${tierBadge(row.tier, true)}<span>${t('stat.tier')}</span></div>`,
        stat(pct(row.wr), t('col.wr'), wrClass(row.wr)),
        stat(pct(row.pickRate), t('stat.pick')),
        pos ? stat(`${pos}.<small> / ${ranked.length}</small>`, t('stat.rank')) : '',
        stat(nfInt.format(row.matches), t('stat.games')),
      ].join('') : '';
      const playing = state.dlHero === hero.id;
      const playBtn = window.chrome?.webview
        ? `<button class="btn ${playing ? 'ghost' : ''} small dl-play" data-dl-play>${icon('gamepad', 15)}${playing ? t('dl.playingThis') : t('dl.playAs', { hero: esc(hero.name) })}</button>`
        : '';

      view.innerHTML = `
      <section class="page champ-page dl-page">
        <a class="back" href="#/dl">${icon('back', 16)}${t('dl.title')}</a>
        <header class="hero ${row?.tier ? 'hero-' + row.tier.cls : ''}" style="--splash:url('${hero.art}')">
          <img class="portrait" src="${hero.card || hero.icon}" alt="">
          <div class="hero-main">
            <h1>${esc(hero.name)}</h1>
            <p class="hero-title">${esc(hero.role || 'Deadlock')}</p>
            ${playBtn}
          </div>
          <div class="hero-stats">${stats}</div>
        </header>
        <div class="filters compact">
          <div class="selects">${rankSelect()}</div>
          <p class="sub">${esc([rankLabel(rank), t('dl.lastDays', { n: DAYS }), totalGames ? games(totalGames) : null].filter(Boolean).join(' · '))}</p>
        </div>
        <div class="champ-grid">
          <article class="card card-wide dl-order-card">
            <h2>${t('dl.order')}</h2>
            <p class="hint">${t('dl.orderHint')}</p>
            ${orderHtml(order)}
          </article>
          <article class="card card-wide dl-early">
            <h2>${t('dl.early')}</h2>
            <p class="hint">${t('dl.earlyHint')}</p>
            ${itemCards(phases.early, 8)}
          </article>
          <article class="card"><h2>${t('dl.mid')}</h2>${itemCards(phases.mid, 6)}</article>
          <article class="card"><h2>${t('dl.late')}</h2>${itemCards(phases.late, 6)}</article>
          <article class="card card-wide"><h2>${t('dl.builds')}</h2><p class="hint">${t('dl.buildsHint')}</p>${buildsHtml(builds, a)}</article>
        </div>
        <p class="note">${t('dl.buildNote')}</p>
      </section>`;
      bindRank(() => renderHero(slug));
      view.querySelector('[data-dl-play]')?.addEventListener('click', () => {
        setPlaying(playing ? null : hero.id);
        toast(playing ? t('dl.stopped') : t('dl.nowPlaying', { hero: hero.name }));
        renderHero(slug);
      });
    } catch (err) {
      if (id === heroReq) view.innerHTML = errorBlock(err);
    }
  }

  // ---------- Itemy ----------

  let itemSlot = 'all';
  let itemFilter = '';
  let itemsData = null;
  let itemsReq = 0;

  function renderItems() {
    Players.setNav('dl-items');
    document.title = `${t('dl.itemsTitle')} – NotLoL`;
    const slotBtns = ['all', ...SLOTS].map(s => `<button class="role-btn slot-btn slot-${s} ${itemSlot === s ? 'on' : ''}" data-slot="${s}">
        <i></i><span>${s === 'all' ? t('role.all') : slotLabel(s)}</span></button>`).join('');
    view.innerHTML = `
    <section class="page dl-page">
      <div class="page-head"><div><h1>${t('dl.itemsTitle')}</h1><p class="sub" id="dlSub">&nbsp;</p></div></div>
      ${tabsHtml('items')}
      <div class="filters">
        <div class="roles">${slotBtns}</div>
        <div class="filter-row">
          <div class="selects">${rankSelect()}</div>
          <label class="filter-search">${icon('search', 16)}
            <input id="dlSearch" class="input" type="search" placeholder="${esc(t('dl.filterItems'))}" value="${esc(itemFilter)}"></label>
        </div>
      </div>
      <div id="dlBody">${loadingBlock(t('loading.data'))}</div>
    </section>`;
    view.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => {
      itemSlot = b.dataset.slot;
      view.querySelectorAll('[data-slot]').forEach(x => x.classList.toggle('on', x === b));
      paintItems();
    }));
    $('#dlSearch').addEventListener('input', e => {
      itemFilter = e.target.value;
      paintItems();
    });
    bindRank(loadItems);
    loadItems();
  }

  async function loadItems() {
    const id = ++itemsReq;
    const rank = rankByKey(state.dlRank);
    try {
      const { rows: heroRows } = await getHeroRows(rank);
      const playerGames = heroRows.reduce((s, r) => s + r.matches, 0);
      const rows = await getItemRows(null, rank, playerGames);
      if (id !== itemsReq) return;
      const avg = rows.reduce((s, r) => s + r.wins, 0) / (rows.reduce((s, r) => s + r.matches, 0) || 1);
      for (const r of rows) r.wrAdj = (r.wins + 300 * avg) / (r.matches + 300);
      itemsData = { rows, rank, playerGames };
      paintItems();
    } catch (err) {
      if (id !== itemsReq) return;
      const body = $('#dlBody');
      if (body) body.innerHTML = errorBlock(err);
    }
  }

  function paintItems() {
    const body = $('#dlBody');
    if (!body || !itemsData) return;
    const { rows: all, rank, playerGames } = itemsData;
    $('#dlSub').textContent = [rankLabel(rank), t('dl.lastDays', { n: DAYS }), playerGames ? games(Math.round(playerGames / PLAYERS)) : null]
      .filter(Boolean).join(' · ');
    const needle = API.normalize(itemFilter);
    const rows = all
      .filter(r => (itemSlot === 'all' || r.item.slot === itemSlot) && (!needle || r.item.norm.includes(needle)) && r.matches >= 50)
      .sort((a, b) => a.item.tier - b.item.tier || b.wrAdj - a.wrAdj);
    if (!rows.length) {
      body.innerHTML = `<div class="state"><p>${t('dl.empty')}</p></div>`;
      return;
    }
    const tiers = [...new Set(rows.map(r => r.item.tier))];
    body.innerHTML = tiers.map(tier => {
      const group = rows.filter(r => r.item.tier === tier);
      const cost = Math.min(...group.map(r => r.item.cost).filter(Boolean));
      return `<article class="card dl-tier-card">
        <h2>${t('dl.itemTier', { n: tier })}${isFinite(cost) ? ` ${souls(cost)}` : ''}</h2>
        <div class="dl-items cols">${group.map(r => `
          <div class="dl-item slot-${r.item.slot}" title="${esc(r.item.name)} · ${esc(slotLabel(r.item.slot))}">
            ${itemImg(r.item)}
            <span class="dl-item-text"><b>${esc(r.item.name)}</b><small>${esc(slotLabel(r.item.slot))}${r.item.active ? ' · ' + t('dl.active') : ''}</small></span>
            <span class="dl-item-stat"><b class="${wrClass(r.wr)}">${pct(r.wr)}</b><small>${t('dl.buys', { p: pct(r.pick) })}</small></span>
          </div>`).join('')}</div>
      </article>`;
    }).join('') + `<p class="note">${t('dl.itemsNote')}</p>`;
  }

  // ---------- Hledání (horní lišta) ----------

  async function search(q) {
    const a = await getAssets();
    const heroes = a.heroes.filter(h => h.norm.includes(q)).map(h => ({ href: heroHref(h), icon: h.icon, name: h.name, sub: h.role || t('dl.col.hero') }));
    const items = a.items.filter(i => i.norm.includes(q)).map(i => ({
      href: '#/dl/items', icon: i.icon, name: i.name, sub: slotLabel(i.slot), item: i.name,
    }));
    return [...heroes, ...items].sort((x, y) => API.normalize(y.name).startsWith(q) - API.normalize(x.name).startsWith(q)).slice(0, 8);
  }
  // Výsledek hledání = item: otevře přehled itemů s tímhle filtrem
  function openItem(name) {
    itemFilter = name;
    itemSlot = 'all';
  }

  // ---------- Router (#/dl/…) ----------

  function route(parts) {
    if (parts[0] === 'hero' && parts[1]) return renderHero(decodeURIComponent(parts[1]));
    if (parts[0] === 'items') return renderItems();
    return renderTier();
  }

  // Záloha (desktop.js): adresy dat Deadlocku pro hrdinu, za kterého hraješ
  async function backupUrls() {
    const rank = rankByKey(state.dlRank);
    const urls = [
      assetUrl('heroes'),
      assetUrl('items'),
      `${BASE}/v1/analytics/hero-stats?min_unix_timestamp=${since()}${rankQ(rank.badge)}`,
    ];
    if (state.dlHero) {
      urls.push(`${BASE}/v1/analytics/item-stats?hero_id=${state.dlHero}&min_unix_timestamp=${since()}${rankQ(rank.badge)}`);
    }
    return urls;
  }

  return { route, search, openItem, pushInGame, setPlaying, backupUrls, getAssets, RANKS };
})();
