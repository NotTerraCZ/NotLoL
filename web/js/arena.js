'use strict';

/*
 * Arena (data z OP.GG – aktuální patch, prizmatické itemy, umístění) a pořadí karet pro Arenu i Mayhem.
 * Používá pomocné funkce z app.js (esc, pct, champOf, …) – volá se až po jeho načtení.
 */
const Arena = (() => {
  // Průměrné umístění 1–8 (menší = lepší); 4,5 je průměr
  const placeClass = p => (p <= 3.6 ? 'wr-great' : p <= 4.1 ? 'wr-good' : p <= 4.6 ? 'wr-mid' : p <= 5 ? 'wr-low' : 'wr-bad');
  const place = p => nf2.format(p);
  const games = n => t('games', { n });

  // ---------- Pořadí karet ----------

  function meta(augMeta, id) {
    const a = augMeta?.get(id);
    return { id, name: a?.name || t('augment.unknown', { id }), icon: a?.icon || '', rarity: a?.rarity || '' };
  }

  /**
   * Arena: aktuální karty z OP.GG seřazené podle průměrného umístění (s tierem),
   * doplněné o karty, které OP.GG nemá, ze starších (ale velkých) dat u.gg – ty jsou označené.
   */
  function arenaCardGroups(augMeta, current, older = [], olderLabel = '') {
    const known = new Set(current.map(a => a.id));
    return API.AUGMENT_RARITIES.map(r => {
      const now = current.map(a => ({ ...a, ...meta(augMeta, a.id) })).filter(a => a.rarity === r.key);
      // Silné vyhlazení: karta s pár hrami nesmí přeskočit kartu se stovkami her
      API.scorePlacement(now, 40, 8);
      // Karty s tierem podle síly, karty s málo hrami (bez tieru) až za nimi
      now.sort((a, b) => (b.eligible - a.eligible) || b.z - a.z);
      const old = older.filter(a => !known.has(a.id)).map(a => ({ ...a, ...meta(augMeta, a.id) }))
        .filter(a => a.rarity === r.key && a.matches >= 30);
      API.scoreRole(old.map(a => Object.assign(a, { pickRate: 1, banRate: 0 })), 0);
      old.sort((a, b) => b.z - a.z);
      const items = [
        ...now.map(a => ({ id: a.id, name: a.name, icon: a.icon, tier: a.tier, stat: t('stat.placeGames', { p: place(a.avgPlace), games: games(a.matches) }), wr: a.wr })),
        ...old.map(a => ({ id: a.id, name: a.name, icon: a.icon, tier: a.tier, stat: t('stat.old', { wr: pct(a.wr), label: olderLabel }), wr: a.wr, old: true })),
      ];
      return { key: r.key, label: r.label, items };
    }).filter(g => g.items.length);
  }

  // Mayhem: u.gg dává jen pořadí – tier podle pozice v seznamu
  function mayhemCardGroups(augMeta, rarities) {
    return API.AUGMENT_RARITIES.map(r => {
      const ids = rarities?.[r.key] || [];
      return {
        key: r.key,
        label: r.label,
        items: ids.map((id, i) => {
          const m = meta(augMeta, id);
          return { id, name: m.name, icon: m.icon, tier: API.tierByPosition(i, ids.length), stat: t('stat.pos', { i: i + 1, n: ids.length }) };
        }),
      };
    }).filter(g => g.items.length);
  }

  // ---------- Tier list ----------

  function tableHtml(rows) {
    const get = { score: r => r.z, name: r => r.name, place: r => -r.avgPlace, wr: r => r.wr, first: r => r.firstRate,
      pick: r => r.pickRate, ban: r => r.banRate, kda: r => r.kda, games: r => r.matches }[state.sortKey] || (r => r.z);
    const dir = state.sortDir;
    rows = rows.slice().sort((a, b) => {
      const x = get(a), y = get(b);
      return (typeof x === 'string' ? I18N.compare(x, y) : x - y) * dir;
    });
    const th = (key, label, cls = '') => {
      const on = state.sortKey === key;
      return `<th class="${cls} sortable ${on ? 'sorted' : ''}" data-sort="${key}">${label}<span class="arrow">${on ? (dir > 0 ? '▲' : '▼') : ''}</span></th>`;
    };
    return `<div class="table-wrap"><table class="tier-table">
      <thead><tr>
        <th class="c-pos">#</th>
        ${th('name', t('col.champ'), 'c-champ')}
        ${th('score', t('col.tier'), 'c-tier')}
        ${th('place', t('col.place'), 'num')}
        ${th('wr', t('col.top4'), 'num')}
        ${th('first', t('col.first'), 'num c-kda')}
        ${th('pick', t('col.pick'), 'num')}
        ${th('ban', t('col.ban'), 'num c-ban')}
        ${th('games', t('col.games'), 'num c-games')}
      </tr></thead>
      <tbody>${rows.map(r => {
        const href = champHref(r.champ);
        return `<tr data-href="${href}" class="tr-${r.tier?.cls || 'none'}">
          <td class="c-pos">${r.pos}</td>
          <td class="c-champ"><a href="${href}"><img src="${r.champ.icon}" alt="" loading="lazy"><span>${esc(r.name)}</span></a></td>
          <td class="c-tier">${tierBadge(r.tier)}</td>
          <td class="num ${placeClass(r.avgPlace)}"><b>${place(r.avgPlace)}</b></td>
          <td class="num ${wrClass(r.wr)}">${pct(r.wr)}</td>
          <td class="num c-kda">${pct(r.firstRate)}</td>
          <td class="num">${pct(r.pickRate)}</td>
          <td class="num c-ban">${pct(r.banRate)}</td>
          <td class="num c-games">${nfInt.format(r.matches)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="note">${t('arena.tableNote')}</p>`;
  }

  // ---------- Stránka šampiona ----------

  function itemRow(st, x, i) {
    const id = x.ids[0];
    const name = st.itemName(id) || t('item.unknown', { id });
    return `<div class="prism-row">
      <span class="pr-rank">${i + 1}</span>
      <img src="${st.itemIcon(id)}" alt="" title="${esc(name)}">
      <span class="pr-name">${esc(name)}</span>
      <span class="pr-place ${placeClass(x.avgPlace)}">${t('place.short', { p: place(x.avgPlace) })}</span>
      <span class="pr-sub">${t('stat.prism', { wr: pct(x.wr), first: pct(x.firstRate), games: games(x.matches) })}</span>
    </div>`;
  }

  function comboRow(st, x) {
    const icons = x.ids.map(id => `<img src="${st.itemIcon(id)}" alt="" title="${esc(st.itemName(id) || '')}">`).join('<span class="chev">›</span>');
    return `<div class="combo-row">
      <div class="icon-row">${icons}</div>
      <span class="pr-place ${placeClass(x.avgPlace)}">${t('place.short', { p: place(x.avgPlace) })}</span>
      <span class="pr-sub">${t('stat.top4Games', { wr: pct(x.wr), games: games(x.matches) })}</span>
    </div>`;
  }

  function pageCards(data) {
    const { st, kit, build, arena: a, augments: cardGroups } = data;
    // Prizmatické itemy: top 10 podle průměrného umístění (vyhlazeno podle počtu her)
    const prism = a.prism.slice();
    API.scorePlacement(prism, 30, 1);
    prism.sort((x, y) => y.z - x.z);
    const synergies = a.synergies.slice();
    API.scorePlacement(synergies, 25, 5);
    const duo = synergies.filter(s => s.eligible).sort((x, y) => y.z - x.z).slice(0, 8);
    const core = a.core.slice(0, 5);
    const items = a.items.slice(0, 10);
    const none = `<p class="muted">${t('noData')}</p>`;

    return `
      <article class="card card-wide"><h2>${t('card.cards')}</h2>
        ${Cards.html(cardGroups, { hint: t('cards.hintArena') })}</article>
      <article class="card card-prism"><h2>${t('prism.title')}</h2>
        <p class="hint">${t('prism.hint')}</p>
        ${prism.length ? prism.slice(0, 10).map((x, i) => itemRow(st, x, i)).join('') : `<p class="muted">${t('noDataYet')}</p>`}</article>
      <article class="card"><h2>${t('card.skills')}</h2>${skillsHtml(build, kit)}
        <h2 class="mt">${t('items.boots')}</h2>${a.boots.slice(0, 3).map(x => comboRow(st, x)).join('') || none}</article>
      <article class="card"><h2>${t('items.core')}</h2>${core.map(x => comboRow(st, x)).join('') || none}
        <h2 class="mt">${t('items.common')}</h2>${items.map((x, i) => itemRow(st, x, i)).join('') || none}</article>
      <article class="card"><h2>${t('partners.title')}</h2><p class="hint">${t('partners.hint')}</p>
        ${duo.length ? duo.map(s => {
          const c = champOf(st, s.champId);
          return `<a class="mu" href="${champHref(c)}"><img src="${c.icon}" alt="" loading="lazy"><span class="mu-name">${esc(c.name)}</span>
            <span class="mu-wr ${placeClass(s.avgPlace)}">${t('place.short', { p: place(s.avgPlace) })}</span>
            <span class="mu-games">${t('stat.top4Games', { wr: pct(s.wr), games: games(s.matches) })}</span></a>`;
        }).join('') : `<p class="muted">${t('fewData')}</p>`}</article>`;
  }

  function heroStats(data) {
    const s = data.arena.summary;
    const r = data.tierRow;
    const stat = (value, label, cls = '') => `<div class="stat"><b class="${cls}">${value}</b><span>${label}</span></div>`;
    return [
      `<div class="stat stat-tier">${tierBadge(r?.tier, true)}<span>${t('stat.tier')}</span></div>`,
      stat(place(s.avgPlace), t('stat.place'), placeClass(s.avgPlace)),
      stat(pct(s.wr), t('stat.top4'), wrClass(s.wr)),
      stat(pct(s.firstRate), t('stat.first')),
      stat(pct(s.pickRate || 0), t('stat.pick')),
      stat(pct(s.banRate || 0), t('stat.ban')),
      r?.roleRank ? stat(`${r.roleRank}.<small> / ${r.roleTotal}</small>`, t('stat.rank')) : '',
      stat(nfInt.format(s.matches), t('stat.games')),
    ].join('');
  }

  // u.gg-tvar buildu z OP.GG dat – kvůli overlayi, panelu a importu item setu
  function toBuild(a) {
    const core = a.core[0];
    const boots = a.boots[0];
    const sk = a.skills[0];
    const used = new Set([...(core?.ids || []), ...(boots?.ids || [])]);
    const extra = a.items.filter(x => !used.has(x.ids[0])).slice(0, 9);
    const opt = list => list.map(x => ({ id: x.ids[0], wins: x.wins, matches: x.matches }));
    return {
      matches: a.summary.matches,
      wins: a.summary.wins,
      start: boots ? { items: boots.ids, matches: boots.matches, wins: boots.wins } : null,
      core: core ? { items: core.ids, matches: core.matches, wins: core.wins } : null,
      skills: sk ? { order: sk.order.slice(0, 18), priority: a.priority || '', matches: sk.matches, wins: sk.wins } : null,
      options: [opt(extra.slice(0, 3)), opt(extra.slice(3, 6)), opt(extra.slice(6, 9))],
      runes: null,
      spells: null,
      shards: null,
    };
  }

  // Prizmatické itemy seřazené od nejlepšího (pro overlay, panel a item set)
  function bestPrism(a, st, n = 10) {
    const prism = a.prism.slice();
    API.scorePlacement(prism, 30, 1);
    return prism.sort((x, y) => y.z - x.z).slice(0, n).map(x => ({
      id: x.ids[0], name: st.itemName(x.ids[0]) || t('item.unknown', { id: x.ids[0] }), icon: st.itemIcon(x.ids[0]),
      avgPlace: x.avgPlace, wr: x.wr, games: x.matches,
    }));
  }

  return { placeClass, place, games, tableHtml, pageCards, heroStats, toBuild, bestPrism, arenaCardGroups, mayhemCardGroups };
})();
