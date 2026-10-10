'use strict';

/*
 * Pořadí karet (augmentů) pro Arenu a ARAM: Mayhem – používá hlavní okno i herní panel (Ctrl+X).
 * groups: [{ key: 'kPrismatic', label: 'Prizmatické', items: [{ name, icon, tier: {key, cls}, stat, old }] }]
 * Položky jsou seřazené od nejlepší; vyhledávání a řazení A–Z běží jen v prohlížeči (bez překreslení).
 */
const Cards = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const normalize = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function html(groups, { hint = '' } = {}) {
    if (!groups?.length) return `<p class="muted">${t('cards.none')}</p>`;
    return `<div class="cards" data-cards>
      <div class="cards-tools">
        <label class="cards-search-wrap">${icon('search', 15)}
          <input class="cards-search" type="search" placeholder="${esc(t('cards.find'))}" autocomplete="off" spellcheck="false"></label>
        <div class="cards-sort" role="group" aria-label="${esc(t('cards.sort'))}">
          <button type="button" data-sort="tier" class="on">${t('cards.byTier')}</button>
          <button type="button" data-sort="az">${t('cards.az')}</button>
        </div>
        ${hint ? `<span class="cards-hint">${hint}</span>` : ''}
      </div>
      <div class="cards-cols">${groups.map(g => `
        <section class="cards-col r-${g.key}">
          <h3>${esc(g.label)} <small>${g.items.length}</small></h3>
          <ol class="cards-list">${g.items.map(itemHtml).join('')}</ol>
        </section>`).join('')}
      </div>
      <p class="cards-empty" hidden>${t('cards.noMatch')}</p>
    </div>`;
  }

  function itemHtml(a, i) {
    return `<li class="card-item ${a.old ? 'old' : ''}" data-name="${esc(normalize(a.name))}" data-order="${i}" data-az="${esc(a.name)}"
        title="${esc(a.name)}${a.old ? ' – ' + esc(t('cards.old')) : ''}">
      <span class="tier t-${a.tier?.cls || 'none'}">${a.tier?.key || '–'}</span>
      ${a.icon ? `<img src="${a.icon}" alt="" loading="lazy">` : '<span class="ph"></span>'}
      <span class="cn">${esc(a.name)}</span>
      <span class="cs">${a.stat || ''}</span>
    </li>`;
  }

  // onFocus: herní panel si při kliknutí do hledání musí vzít klávesnici
  function bind(root, { onFocus } = {}) {
    root.querySelectorAll('[data-cards]').forEach(box => {
      if (box.dataset.bound) return;
      box.dataset.bound = '1';
      const input = box.querySelector('.cards-search');
      const lists = [...box.querySelectorAll('.cards-list')];
      let sort = 'tier';
      const apply = () => {
        const q = normalize(input.value);
        let shown = 0;
        for (const ol of lists) {
          const items = [...ol.children].sort((a, b) => (sort === 'az'
            ? I18N.compare(a.dataset.az, b.dataset.az)
            : a.dataset.order - b.dataset.order));
          for (const li of items) {
            const visible = !q || li.dataset.name.includes(q);
            li.hidden = !visible;
            if (visible) shown++;
            ol.appendChild(li);
          }
        }
        box.querySelector('.cards-empty').hidden = shown > 0;
      };
      input.addEventListener('input', apply);
      if (onFocus) input.addEventListener('mousedown', onFocus);
      box.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
        sort = b.dataset.sort;
        box.querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('on', x === b));
        apply();
      }));
    });
  }

  return { html, bind };
})();
