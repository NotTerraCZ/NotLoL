'use strict';

/*
 * Datová vrstva.
 * - u.gg: neoficiální veřejné JSON soubory na stats2.u.gg (stejné, ze kterých čte web u.gg)
 * - Riot Data Dragon: jména, ikony šampionů, itemů, run a kouzel (v jazyce appky)
 * - CommunityDragon: ikony stat shardů a rolí, augmenty
 */
const API = (() => {
  const STATS = 'https://stats2.u.gg/lol';
  const MAYHEM = 'https://static.bigbrain.gg/custom-aram-mayhem';
  const UGG_VERSIONS = 'https://static.bigbrain.gg/assets/lol/riot_patch_update/prod/ugg/ugg-api-versions.json';
  const DD = 'https://ddragon.leagueoflegends.com';
  const CD = 'https://raw.communitydragon.org/latest';
  const LANG = I18N.lang.dd;
  const CD_LANG = I18N.lang.cd;

  // Klíč = název v URL u champion_ranking, id = číselný klíč v overview/matchups
  const REGIONS = [
    { key: 'world', id: 12, label: 'Celý svět' },
    { key: 'euw1', id: 2, label: 'EU West' },
    { key: 'eun1', id: 4, label: 'EU Nordic & East' },
    { key: 'na1', id: 1, label: 'North America' },
    { key: 'kr', id: 3, label: 'Korea' },
    { key: 'br1', id: 5, label: 'Brazílie' },
    { key: 'la1', id: 6, label: 'Latinská Amerika (sever)' },
    { key: 'la2', id: 7, label: 'Latinská Amerika (jih)' },
    { key: 'oc1', id: 8, label: 'Oceánie' },
    { key: 'ru', id: 9, label: 'Rusko' },
    { key: 'tr1', id: 10, label: 'Turecko' },
    { key: 'jp1', id: 11, label: 'Japonsko' },
    { key: 'sg2', id: 14, label: 'Jihovýchodní Asie' },
    { key: 'tw2', id: 16, label: 'Tchaj-wan' },
    { key: 'vn2', id: 17, label: 'Vietnam' },
    { key: 'me1', id: 18, label: 'Blízký východ' },
  ];

  const RANKS = [
    { key: 'challenger', id: 1, label: 'Challenger' },
    { key: 'grandmaster', id: 13, label: 'Grandmaster' },
    { key: 'master', id: 2, label: 'Master' },
    { key: 'master_plus', id: 14, label: 'Master+' },
    { key: 'diamond', id: 3, label: 'Diamond' },
    { key: 'diamond_2_plus', id: 15, label: 'Diamond 2+' },
    { key: 'diamond_plus', id: 11, label: 'Diamond+' },
    { key: 'emerald', id: 16, label: 'Emerald' },
    { key: 'emerald_plus', id: 17, label: 'Emerald+' },
    { key: 'platinum', id: 4, label: 'Platinum' },
    { key: 'platinum_plus', id: 10, label: 'Platinum+' },
    { key: 'gold', id: 5, label: 'Gold' },
    { key: 'silver', id: 6, label: 'Silver' },
    { key: 'bronze', id: 7, label: 'Bronze' },
    { key: 'iron', id: 12, label: 'Iron' },
    { key: 'overall', id: 8, label: 'Všechny ranky' },
  ];

  // overallOnly = u.gg nemá data po rankách, worldOnly = jen celý svět, noRoles = mód bez lajn
  const QUEUES = [
    { key: 'ranked_solo_5x5', label: 'Ranked Solo/Duo' },
    { key: 'ranked_flex_sr', label: 'Ranked Flex' },
    { key: 'normal_draft_5x5', label: 'Normal Draft', overallOnly: true },
    { key: 'normal_aram', label: 'ARAM', overallOnly: true, noRoles: true, aram: true },
    { key: 'aram_mayhem', label: 'ARAM: Mayhem', overallOnly: true, worldOnly: true, noRoles: true, mayhem: true },
    { key: 'arena', label: 'Arena', overallOnly: true, worldOnly: true, noRoles: true, arena: true },
  ];
  // Podle módu z LoL klienta (výběr šampiona / živá hra) vybere data
  function queueForGame(gameMode, queueId) {
    const mode = String(gameMode || '').toUpperCase();
    if (mode === 'CHERRY' || [1700, 1710, 1740, 1750].includes(queueId)) return 'arena';
    if (mode === 'KIWI' || mode.includes('MAYHEM') || queueId === 2400) return 'aram_mayhem';
    if (mode === 'ARAM') return 'normal_aram';
    return null; // Summoner's Rift – nech mód, který má hráč nastavený
  }

  const AUGMENT_RARITIES = ['kPrismatic', 'kGold', 'kSilver'].map(key => ({ key, label: t(`rarity.${key}`) }));

  // Popisky v jazyce appky (po změně jazyka se stránka načte znovu)
  REGIONS.forEach(r => (r.label = t(`region.${r.key}`)));
  RANKS.find(r => r.key === 'overall').label = t('rank.overall');

  const ROLES = [
    { key: 'top', id: 4, label: 'Top', icon: 'top' },
    { key: 'jungle', id: 1, label: 'Jungle', icon: 'jungle' },
    { key: 'mid', id: 5, label: 'Mid', icon: 'middle' },
    { key: 'adc', id: 3, label: 'ADC', icon: 'bottom' },
    { key: 'supp', id: 2, label: 'Support', icon: 'utility' },
  ];
  const ARAM_ROLE = { key: 'none', id: 6, label: 'ARAM', icon: 'fill' };

  // Řádky stat shardů (po reworku 2024)
  const SHARD_ROWS = [[5008, 5005, 5007], [5008, 5010, 5001], [5011, 5013, 5001]];

  const TIERS = [
    { key: 'S+', cls: 'splus', z: 1.6 },
    { key: 'S', cls: 's', z: 0.85 },
    { key: 'A', cls: 'a', z: 0.2 },
    { key: 'B', cls: 'b', z: -0.4 },
    { key: 'C', cls: 'c', z: -1.05 },
    { key: 'D', cls: 'd', z: -Infinity },
  ];

  const regionByKey = k => REGIONS.find(r => r.key === k) || REGIONS[0];
  const rankByKey = k => RANKS.find(r => r.key === k) || RANKS.find(r => r.key === 'emerald_plus');
  const queueByKey = k => QUEUES.find(q => q.key === k) || QUEUES[0];
  const roleByKey = k => ROLES.find(r => r.key === k) || (k === ARAM_ROLE.key ? ARAM_ROLE : null);
  const roleById = id => ROLES.find(r => r.id === +id) || (+id === ARAM_ROLE.id ? ARAM_ROLE : null);
  // Pozice z LoL klienta (výběr šampiona i živá hra) -> role
  const POSITION_ROLE = { top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'supp' };
  const roleFromPosition = pos => roleByKey(POSITION_ROLE[String(pos || '').toLowerCase()]) || null;
  const roleIcon = icon =>
    `${CD}/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${icon}.png`;
  const cdAsset = path =>
    `${CD}/plugins/rcp-be-lol-game-data/global/default/${String(path).replace(/^\/lol-game-data\/assets\//i, '').toLowerCase()}`;

  const normalize = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const stripTags = s => String(s || '').replace(/<[^>]*>/g, '');

  class HttpError extends Error {
    constructor(status, url) {
      super(`HTTP ${status}`);
      this.status = status;
      this.url = url;
    }
  }

  const cache = new Map();
  function getJSON(url) {
    let p = cache.get(url);
    if (!p) {
      // Druhý pokus obchází cache prohlížeče (odpověď uložená bez CORS hlavičky by jinak selhala)
      p = fetch(url).catch(() => fetch(url, { cache: 'reload' })).then(r => {
        // Desktop appka vrátila zálohu, protože server nejde
        const offline = r.headers.get('X-NotLoL-Offline');
        if (offline) window.dispatchEvent(new CustomEvent('notlol-offline', { detail: offline }));
        if (!r.ok) throw new HttpError(r.status, url);
        return r.json();
      });
      p.catch(() => cache.delete(url));
      cache.set(url, p);
    }
    return p;
  }

  // ---------- Patche ----------

  let uggVersions = null;
  const patchParts = p => p.split('_').map(Number);
  const cmpPatchDesc = (a, b) => {
    const [a1, a2] = patchParts(a), [b1, b2] = patchParts(b);
    return b1 - a1 || b2 - a2;
  };
  // Riot od roku 2025 pojmenovává patche podle roku: verze hry 16.20 = „Patch 26.20“
  const patchLabel = p => {
    const [major, minor] = patchParts(p);
    return major >= 15 ? `${major + 10}.${String(minor).padStart(2, '0')}` : `${major}.${minor}`;
  };

  async function getPatches() {
    uggVersions = await getJSON(UGG_VERSIONS);
    return Object.keys(uggVersions).filter(k => /^\d+_\d+$/.test(k)).sort(cmpPatchDesc);
  }

  function statsUrl(endpoint, patch, path) {
    const v = uggVersions?.[patch]?.[endpoint] || '1.5.0';
    const api = v.split('.').slice(0, 2).join('.');
    return `${STATS}/${api}/${endpoint}/${path}/${v}.json`;
  }

  // ---------- Statická data (Data Dragon) ----------

  const staticCache = new Map();
  function getStatic(patch) {
    let p = staticCache.get(patch);
    if (!p) {
      p = loadStatic(patch);
      p.catch(() => staticCache.delete(patch));
      staticCache.set(patch, p);
    }
    return p;
  }

  async function loadStatic(patch) {
    const versions = await getJSON(`${DD}/api/versions.json`);
    const latest = versions[0];
    // Itemy/runy z verze odpovídající patchi, šampioni vždy z nejnovější (kvůli novým šampionům)
    const prefix = patch.replace('_', '.') + '.';
    const pv = versions.find(v => v.startsWith(prefix)) || latest;

    const [champJson, itemJson, runeJson, spellJson, perks] = await Promise.all([
      getJSON(`${DD}/cdn/${latest}/data/${LANG}/champion.json`),
      getJSON(`${DD}/cdn/${pv}/data/${LANG}/item.json`),
      getJSON(`${DD}/cdn/${pv}/data/${LANG}/runesReforged.json`),
      getJSON(`${DD}/cdn/${pv}/data/${LANG}/summoner.json`),
      getJSON(`${CD}/plugins/rcp-be-lol-game-data/global/${CD_LANG}/v1/perks.json`).catch(() => []),
    ]);

    const champs = new Map();
    const champBySlug = new Map();
    for (const c of Object.values(champJson.data)) {
      const champ = {
        id: c.id,
        key: +c.key,
        slug: c.id.toLowerCase(),
        name: c.name,
        title: c.title,
        norm: normalize(c.name),
        // Hledat jde i podle anglického id (Wukong = MonkeyKing apod.)
        alt: normalize(c.id),
        icon: `${DD}/cdn/${latest}/img/champion/${c.image.full}`,
        splash: `${DD}/cdn/img/champion/splash/${c.id}_0.jpg`,
      };
      champs.set(champ.key, champ);
      champBySlug.set(champ.slug, champ);
    }
    const champList = [...champs.values()].sort((a, b) => I18N.compare(a.name, b.name));

    const items = new Map();
    // Arena používá vlastní ID itemů (220000 + ID) – když v datech chybí, vezmi běžný item
    const itemIcon = id => items.get(id)?.icon
      || (id > 220000 && items.has(id - 220000) ? items.get(id - 220000).icon : `${DD}/cdn/${pv}/img/item/${id}.png`);
    const itemName = id => items.get(id)?.name || items.get(id - 220000)?.name;
    for (const [id, it] of Object.entries(itemJson.data)) {
      items.set(+id, {
        id: +id,
        name: it.name,
        text: it.plaintext || '',
        gold: it.gold?.total,
        icon: `${DD}/cdn/${pv}/img/item/${id}.png`,
      });
    }

    const styles = new Map();
    const runes = new Map();
    for (const s of runeJson) {
      styles.set(s.id, {
        id: s.id,
        name: s.name,
        icon: `${DD}/cdn/img/${s.icon}`,
        slots: s.slots.map(sl => sl.runes.map(r => r.id)),
      });
      for (const sl of s.slots) {
        for (const r of sl.runes) {
          runes.set(r.id, { id: r.id, name: r.name, desc: stripTags(r.shortDesc), icon: `${DD}/cdn/img/${r.icon}` });
        }
      }
    }

    const spells = new Map();
    for (const s of Object.values(spellJson.data)) {
      spells.set(+s.key, { name: s.name, icon: `${DD}/cdn/${pv}/img/spell/${s.image.full}` });
    }

    const shards = new Map();
    for (const p of perks) {
      if (p.id >= 5000 && p.id < 5100) shards.set(p.id, { name: p.name, icon: cdAsset(p.iconPath) });
    }

    return {
      ddVersion: latest,
      itemVersion: pv,
      champs,
      champBySlug,
      champList,
      items,
      styles,
      runes,
      spells,
      shards,
      itemIcon,
      itemName,
    };
  }

  async function getChampionKit(st, champ) {
    const j = await getJSON(`${DD}/cdn/${st.ddVersion}/data/${LANG}/champion/${champ.id}.json`);
    const c = j.data[champ.id];
    return {
      spells: c.spells.map((s, i) => ({
        key: 'QWER'[i],
        name: s.name,
        icon: `${DD}/cdn/${st.ddVersion}/img/spell/${s.image.full}`,
      })),
      passive: { name: c.passive.name, icon: `${DD}/cdn/${st.ddVersion}/img/passive/${c.passive.image.full}` },
    };
  }

  // ---------- Tier list (u.gg champion_ranking) ----------
  //
  // Formát: [ {role: [[champId, [[counterId, výhry counteru, zápasy] x10], výhry, zápasy,
  //                    damage, gold, kills, assists, deaths, cs], ...]},
  //           {champId: bany, ..., total_matches},
  //           "aktualizováno ISO",
  //           počet her (jmenovatel pro pick rate) ]

  async function getTierList({ patch, region, rank, queue }) {
    const raw = await getJSON(statsUrl('champion_ranking', patch, `${region}/${patch}/${queue}/${rank}`));
    const [byRole, bans = {}, updated, games] = raw;
    const totalMatches = bans.total_matches || games || 1;
    const totalGames = typeof games === 'number' && games > 0 ? games : totalMatches;

    const roles = {};
    for (const [roleKey, list] of Object.entries(byRole || {})) {
      roles[roleKey] = list.map(e => {
        const matches = e[3] || 0;
        const per = v => (matches ? (v || 0) / matches : 0);
        return {
          champId: +e[0],
          role: roleKey,
          wins: e[2] || 0,
          matches,
          wr: matches ? e[2] / matches : 0,
          pickRate: matches / totalGames,
          banRate: (bans[e[0]] || 0) / totalMatches,
          kills: per(e[6]),
          assists: per(e[7]),
          deaths: per(e[8]),
          cs: per(e[9]),
          kda: ((e[6] || 0) + (e[7] || 0)) / Math.max(1, e[8] || 0),
          // wr = win rate counteru proti tomuto šampionovi
          counters: (e[1] || []).map(([id, w, m]) => ({ champId: id, wr: m ? w / m : 0, matches: m })),
        };
      });
    }
    return { roles, updated: typeof updated === 'string' ? updated : null, totalGames };
  }

  /*
   * Vlastní tier skóre (u.gg svůj vzorec nezveřejňuje):
   *   win rate vyhlazený k průměru role (méně her = menší váha)
   *   + bonus za pick rate (logaritmicky vůči mediánu role)
   *   + bonus za ban rate
   * Tier = podle z-skóre v rámci role (z je srovnatelné i napříč rolemi).
   */
  const PRIOR_GAMES = 400;
  const MIN_GAMES = 30;

  function scoreRole(rows, minPick) {
    const isElig = r => r.matches >= MIN_GAMES && r.pickRate >= minPick;
    const elig = rows.filter(isElig);
    const W = elig.reduce((s, r) => s + r.wins, 0);
    const M = elig.reduce((s, r) => s + r.matches, 0);
    const avgWR = M ? W / M : 0.5;
    const prs = elig.map(r => r.pickRate).sort((a, b) => a - b);
    const medPR = prs.length ? prs[prs.length >> 1] : 0.01;

    for (const r of rows) {
      const wrAdj = (r.wins + PRIOR_GAMES * avgWR) / (r.matches + PRIOR_GAMES);
      r.score = (wrAdj - avgWR) * 100 + 0.5 * Math.log(Math.max(r.pickRate, 1e-5) / medPR) + 2 * r.banRate;
      r.eligible = isElig(r);
      r.z = 0;
      r.tier = null;
      r.roleRank = null;
      r.roleTotal = elig.length;
    }
    if (!elig.length) return;

    const mean = elig.reduce((s, r) => s + r.score, 0) / elig.length;
    const sd = Math.sqrt(elig.reduce((s, r) => s + (r.score - mean) ** 2, 0) / elig.length) || 1;
    for (const r of rows) {
      r.z = (r.score - mean) / sd;
      if (r.eligible) r.tier = TIERS.find(t => r.z >= t.z);
    }
    elig.sort((a, b) => b.score - a.score).forEach((r, i) => (r.roleRank = i + 1));
  }

  // ---------- Šampion (u.gg overview + matchups) ----------
  //
  // overview[regionId][rankId][roleId] = [[runy, kouzla, start, core, skilly, možnosti itemů,
  //                                         [výhry, zápasy], ?, shardy, ...], "aktualizováno"]

  async function getChampionStats({ patch, queue, champId }) {
    const [ov, mu] = await Promise.all([
      getJSON(statsUrl('overview', patch, `${patch}/${queue}/${champId}`)),
      getJSON(statsUrl('matchups', patch, `${patch}/${queue}/${champId}`)).catch(() => null),
    ]);
    return { ov, mu };
  }

  function championRoles(stats, regionId, rankId) {
    const node = stats.ov?.[regionId]?.[rankId] || {};
    return Object.entries(node)
      .map(([roleId, v]) => ({ role: roleById(roleId), matches: v?.[0]?.[6]?.[1] || 0 }))
      .filter(r => r.role && r.matches > 0)
      .sort((a, b) => b.matches - a.matches);
  }

  function championBuild(stats, regionId, rankId, roleId) {
    const entry = stats.ov?.[regionId]?.[rankId]?.[roleId];
    if (!entry) return null;
    const [d = [], updated] = entry;
    const [runes, spells, start, core, skills, opts, totals, , shards] = d;
    const pair = a => ({ matches: a?.[0] || 0, wins: a?.[1] || 0 });
    return {
      updated,
      wins: totals?.[0] || 0,
      matches: totals?.[1] || 0,
      runes: runes && { ...pair(runes), primary: runes[2], sub: runes[3], perks: runes[4] || [] },
      spells: spells && { ...pair(spells), ids: spells[2] || [] },
      start: start && { ...pair(start), items: start[2] || [] },
      core: core && { ...pair(core), items: core[2] || [] },
      skills: skills && { ...pair(skills), order: skills[2] || [], priority: skills[3] || '' },
      options: (opts || []).slice(0, 3).map(list => (list || []).map(([id, w, m]) => ({ id, wins: w, matches: m }))),
      shards: shards && { ...pair(shards), ids: (shards[2] || []).map(Number) },
    };
  }

  // Arena: overview[...][13 položek], index 10 = duo partneři, 11 = augmenty ([id, výhry, zápasy])
  function championArena(stats, regionId, rankId, roleId) {
    const d = stats.ov?.[regionId]?.[rankId]?.[roleId]?.[0] || [];
    const list = a => (Array.isArray(a) ? a : []).map(([id, w, m]) => ({ id, wins: w, matches: m, wr: m ? w / m : 0 }));
    return { duos: list(d[10]), augments: list(d[11]) };
  }

  // ---------- ARAM: Mayhem (u.gg má vlastní soubory jen s pořadím) ----------

  async function getMayhemTierList(patch) {
    const j = await getJSON(`${MAYHEM}/${patch}/tierlist-champions-${patch}.json`);
    const rows = [];
    for (const tier of TIERS) {
      for (const id of j.tiers?.[tier.key] || []) rows.push({ champId: +id, role: 'none', tier, z: -rows.length });
    }
    return { rows, updated: j.lastUpdated || null };
  }

  // { kPrismatic: [id, ...], kGold: [...], kSilver: [...] } – seřazené od nejlepšího
  async function getMayhemAugments(patch, champId) {
    const j = await getJSON(`${MAYHEM}/${patch}/tierlist-per-champion-augments-rarity-${patch}/tierlist-augments-${champId}-${patch}.json`);
    return j.rarities || {};
  }

  // Augmenty Areny i Mayhemu (v jazyce appky) z CommunityDragonu
  let augmentsPromise = null;
  function getAugments() {
    augmentsPromise ??= getJSON(`${CD}/plugins/rcp-be-lol-game-data/global/${CD_LANG}/v1/cherry-augments.json`).then(list => {
      const map = new Map();
      for (const a of list) {
        map.set(a.id, { id: a.id, name: a.nameTRA || t('augment.unknown', { id: a.id }), rarity: a.rarity, icon: a.augmentSmallIconPath ? cdAsset(a.augmentSmallIconPath) : '' });
      }
      return map;
    });
    augmentsPromise.catch(() => (augmentsPromise = null));
    return augmentsPromise;
  }

  // Názvy itemů v daném jazyce Data Dragonu ("cs_CZ", "en_US") – pro čtení prizmatických itemů ze hry
  function getItemNames(version, ddLang) {
    return getJSON(`${DD}/cdn/${version}/data/${ddLang}/item.json`)
      .then(j => new Map(Object.entries(j.data || {}).map(([id, it]) => [+id, it.name])));
  }

  // Jen názvy augmentů v daném jazyce CommunityDragonu ("cs_cz", "default" = angličtina) – pro čtení karet ze hry
  const augNames = new Map();
  function getAugmentNames(cdLang) {
    let p = augNames.get(cdLang);
    if (!p) {
      p = getJSON(`${CD}/plugins/rcp-be-lol-game-data/global/${cdLang}/v1/cherry-augments.json`)
        .then(list => new Map(list.filter(a => a.nameTRA).map(a => [a.id, a.nameTRA])));
      p.catch(() => augNames.delete(cdLang));
      augNames.set(cdLang, p);
    }
    return p;
  }

  // ---------- Arena z OP.GG (aktuální patch, prizmatické itemy, umístění) ----------
  //
  // u.gg má Arenu jen ze starších patchů a prizmatické itemy vůbec – OP.GG má obojí.
  // play = her, win = top 4, total_place = součet umístění (1–8), first_place = počet výher.

  const OPGG = 'https://lol-api-champion.op.gg/api/global/champions/arena';

  const stat = s => ({
    matches: s.play || 0,
    wins: s.win || 0,
    wr: s.play ? s.win / s.play : 0,
    avgPlace: s.play ? s.total_place / s.play : 0,
    firstRate: s.play ? s.first_place / s.play : 0,
    totalPlace: s.total_place || 0,
  });

  async function getArenaTierList() {
    const j = await getJSON(OPGG);
    const rows = (j.data || []).filter(c => c.average_stats && !c.is_rip).map(c => {
      const s = c.average_stats;
      return {
        champId: c.id, role: 'none', ...stat(s),
        pickRate: s.pick_rate || 0, banRate: s.ban_rate || 0,
        kda: ((s.kills || 0) + (s.assists || 0)) / Math.max(1, s.deaths || 0),
        counters: [],
      };
    });
    scorePlacement(rows, 40);
    const games = rows.reduce((sum, r) => sum + r.matches, 0) / 16; // 16 hráčů v zápase
    return { rows, updated: null, version: j.meta?.version, totalGames: Math.round(games), source: 'OP.GG' };
  }

  async function getArenaChampion(champId) {
    const j = await getJSON(`${OPGG}/${champId}`);
    const d = j.data || {};
    const list = arr => (arr || []).map(x => ({ ids: x.ids || [], ...stat(x) }));
    return {
      version: j.meta?.version,
      updated: j.meta?.cached_at,
      summary: d.summary?.average_stats ? { ...stat(d.summary.average_stats), pickRate: d.summary.average_stats.pick_rate, banRate: d.summary.average_stats.ban_rate } : null,
      core: list(d.core_items),
      boots: list(d.boots),
      items: list(d.last_items),
      prism: list(d.prism_items),
      skills: (d.skills || []).map(s => ({ order: s.order || [], ...stat(s) })),
      priority: (d.skill_masteries?.[0]?.ids || []).join(''),
      // OP.GG čísluje vzácnost 1/4/8 – skutečnou vzácnost bereme z CommunityDragonu
      augments: (d.augment_group || []).flatMap(g => (g.augments || []).map(a => ({ id: a.id, ...stat(a) }))),
      synergies: (d.synergies || []).map(s => ({ champId: s.champion_id, ...stat(s) })),
    };
  }

  /**
   * Skóre podle průměrného umístění (menší = lepší), vyhlazené k průměru – málo her = menší váha.
   * Nastaví r.z a r.tier (S+ … D) stejně jako u ostatních tier listů.
   */
  function scorePlacement(rows, prior = 20, minGames = 10) {
    const elig = rows.filter(r => r.matches >= minGames);
    const P = elig.reduce((s, r) => s + r.totalPlace, 0);
    const M = elig.reduce((s, r) => s + r.matches, 0);
    const mean = M ? P / M : 4.5;
    for (const r of rows) {
      const adj = (r.totalPlace + prior * mean) / (r.matches + prior);
      r.score = mean - adj;
      r.eligible = r.matches >= minGames;
      r.tier = null;
      r.z = r.score;
    }
    if (elig.length < 2) return;
    const avg = elig.reduce((s, r) => s + r.score, 0) / elig.length;
    const sd = Math.sqrt(elig.reduce((s, r) => s + (r.score - avg) ** 2, 0) / elig.length) || 1;
    for (const r of rows) {
      r.z = (r.score - avg) / sd;
      if (r.eligible) r.tier = TIERS.find(t => r.z >= t.z);
    }
  }

  // Tier podle pořadí (u.gg u Mayhemu dává jen seřazený seznam bez čísel)
  function tierByPosition(i, n) {
    const p = n > 1 ? i / (n - 1) : 0;
    return TIERS[p < 0.08 ? 0 : p < 0.22 ? 1 : p < 0.45 ? 2 : p < 0.7 ? 3 : p < 0.88 ? 4 : 5];
  }

  // matchups[regionId][rankId][roleId] = [[[soupeřId, výhry SOUPEŘE, zápasy, ...], ...], "aktualizováno"]
  function championMatchups(stats, regionId, rankId, roleId) {
    const list = stats.mu?.[regionId]?.[rankId]?.[roleId]?.[0];
    if (!Array.isArray(list)) return [];
    return list.map(e => ({ champId: e[0], matches: e[2], wr: e[2] ? 1 - e[1] / e[2] : 0 }));
  }

  return {
    REGIONS, RANKS, QUEUES, ROLES, ARAM_ROLE, SHARD_ROWS, TIERS, AUGMENT_RARITIES,
    regionByKey, rankByKey, queueByKey, queueForGame, roleByKey, roleById, roleFromPosition, roleIcon,
    normalize, patchLabel, HttpError,
    getPatches, getStatic, getChampionKit, getTierList, scoreRole,
    getChampionStats, championRoles, championBuild, championMatchups, championArena,
    getMayhemTierList, getMayhemAugments, getAugments, getAugmentNames, getItemNames,
    getArenaTierList, getArenaChampion, scorePlacement, tierByPosition,
    // Zapomene stažená data v paměti, takže další dotazy půjdou znovu (záloha)
    clearCaches: () => {
      cache.clear();
      staticCache.clear();
      augNames.clear();
      augmentsPromise = null;
    },
  };
})();
