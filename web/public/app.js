const $ = (sel) => document.querySelector(sel);

async function api(url, opts) {
  const res = await fetch(url, opts);
  // Session expired or never signed in: go to the login page
  if (res.status === 401) {
    location.assign('/login');
    throw new Error('Sign in required');
  }
  if (!res.ok) {
    // Server sends { error } with a readable text
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) {
        msg = body.error;
      }
    } catch {
      // no JSON body
    }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// Write requests must send JSON. The server blocks other types (CSRF guard).
function post(url, body = {}) {
  return api(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
}

// Confirm dialog. Resolves true on OK. Cancel has autofocus.
// Esc closes without a returnValue, so it counts as cancel.
// danger: true for destructive actions. The OK button then looks like a danger button.
function confirmAction(title, text, okLabel, {danger = false} = {}) {
  const dlg = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = okLabel;
  $('#confirmOk').className = danger ? 'danger' : 'primary';
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(resolve => dlg.addEventListener('close', () => {
    const ok = dlg.returnValue === 'ok';
    // Reset, so an old value cannot leak into the next Esc close
    dlg.returnValue = '';
    resolve(ok);
  }, {once: true}));
}

// ---- Tabs ----
const tabs = [...document.querySelectorAll('#tabs [role="tab"]')];
const TAB_LOADERS = {
  dashboard: () => loadDashboard(),
  offers: () => loadOffers(),
  trades: () => loadTrades(),
  inventory: () => loadInventory(),
  config: () => loadConfig(),
  status: () => loadStatus(),
};

function activePanelId() {
  return tabs.find(t => t.ariaSelected === 'true')?.dataset.tab;
}

function selectTab(tab) {
  for (const t of tabs) {
    const selected = t === tab;
    t.ariaSelected = String(selected);
    // focusgroup: focus entering the tablist lands on the selected tab
    t.toggleAttribute('focusgroupstart', selected);
    $('#' + t.dataset.tab).hidden = !selected;
  }
  updateRovingTabindex();
  Promise.resolve(TAB_LOADERS[tab.dataset.tab]?.())
      .catch(err => console.error(`Loading ${tab.dataset.tab} failed`, err));
}

tabs.forEach(tab => tab.addEventListener('click', () => selectTab(tab)));

// Fallback where focusgroup is missing: roving tabindex with arrow keys.
// Selection by activation (Enter/Space), because each panel loads data.
const hasFocusgroup = Object.hasOwn(HTMLElement.prototype, 'focusGroup');

function updateRovingTabindex() {
  if (hasFocusgroup) {
    return;
  }
  tabs.forEach(t => { t.tabIndex = t.ariaSelected === 'true' ? 0 : -1; });
}

if (!hasFocusgroup) {
  updateRovingTabindex();
  $('#tabs').addEventListener('keydown', e => {
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) {
      return;
    }
    const next = {
      ArrowRight: tabs[(i + 1) % tabs.length],
      ArrowLeft: tabs[(i - 1 + tabs.length) % tabs.length],
      Home: tabs[0],
      End: tabs[tabs.length - 1],
    }[e.key];
    if (next) {
      e.preventDefault();
      next.focus();
      next.scrollIntoView({block: 'nearest', inline: 'nearest'});
    }
  });
}

// ---- Dashboard ----
let tradesChart, cardsChart;

async function loadDashboard() {
  const groupBy = $('#groupBy').value;
  const data = await api(`/api/trades/stats?groupBy=${groupBy}`);
  const labels = data.map(d => d.bucket);

  const totals = data.reduce((a, d) => ({
    trades: a.trades + d.trades,
    accepted: a.accepted + (d.accepted || 0),
    gained: a.gained + (d.gained || 0),
    given: a.given + (d.given || 0),
  }), {trades: 0, accepted: 0, gained: 0, given: 0});

  const rate = totals.trades ? Math.round(
      (totals.accepted / totals.trades) * 100) : 0;
  const net = totals.gained - totals.given;
  $('#tiles').innerHTML = [
    tile(formatNumber(totals.gained), 'Cards in', 'gets'),
    tile(formatNumber(totals.given), 'Cards out', 'gives'),
    tile(`${net > 0 ? '+' : net < 0 ? '−' : ''}${formatNumber(Math.abs(net))}`, 'Net cards'),
    tile(formatNumber(totals.trades), 'Offers'),
    tile(`${rate}%`, 'Accepted'),
  ].join('');

  tradesChart = drawChart(tradesChart, 'tradesChart', labels, [
    {label: 'Offers', data: data.map(d => d.trades), color: css('--accent')},
    {label: 'Accepted', data: data.map(d => d.accepted || 0), color: css('--series-2')},
  ]);

  cardsChart = drawChart(cardsChart, 'cardsChart', labels, [
    {label: 'Cards in', data: data.map(d => d.gained || 0), color: css('--gets')},
    {label: 'Cards out', data: data.map(d => d.given || 0), color: css('--gives')},
  ]);

  await loadReasonStats();
}

// ---- Decline reasons ----
const REASON_LABELS = {
  non_card_give: 'Bot would give an item that is not a card',
  non_card_get: 'Bot would get an item that is not a card',
  non_card: 'Item that is not a card (old entry)',
  never_give: 'Card of a game the bot never gives',
  never_get: 'Card of a game the bot never gets',
  never_list: 'Card from a "Never" list (old entry)',
  last_copy: 'Last copy of a protected card',
  inventory_missing: 'Inventory not loaded',
  same_set_give: 'Card given outside of a same-set swap',
  same_set_get: 'Card received outside of a same-set swap',
  same_set: 'Protected card not in a 1:1 swap (old entry)',
  sale_give: 'Sale card for fewer than 3 cards',
  unknown_type: 'Card type unknown (normal or foil)',
  ratio: 'Cross-set ratio too low (needs 2 for 1)',
  other: 'Other reason',
};

async function loadReasonStats() {
  const days = $('#reasonDays').value;
  const {reasons, totals} = await api(`/api/trades/reasons${days ? `?days=${days}` : ''}`);
  $('#reasonTotals').innerHTML = [
    tile(formatNumber(totals.declined), 'Not accepted'),
    tile(formatNumber(totals.autoDeclined), 'Declined automatically'),
    tile(formatNumber(totals.manualAccepted), 'Accepted by you'),
    tile(formatNumber(totals.manualDeclined), 'Declined by you'),
  ].join('');
  const max = Math.max(1, ...reasons.map(r => r.count));
  // One series: bar length shows the count, the number stays as text.
  $('#reasonList').innerHTML = reasons.map(r => `
      <li>
        <span class="bar-label">${escapeHtml(REASON_LABELS[r.code] || r.code)}</span>
        <span class="bar-track" aria-hidden="true"><span class="bar" style="width:${(r.count / max) * 100}%"></span></span>
        <span class="bar-value">${r.count}</span>
      </li>`).join('') || '<li class="empty">No offers were declined in this period.</li>';
}

$('#reasonDays').addEventListener('change',
    () => loadReasonStats().catch(err => console.error('Reason stats failed', err)));

// One cell of a ledger row. flow 'gets' or 'gives' adds the color rule of the card flow.
function tile(value, label, flow) {
  return `<div class="stat"${flow ? ` data-flow="${flow}"` : ''}><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

// Reads a design token from tokens.css, so charts use the same colors as the page.
function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-GB');
}

// Chart look: 2px lines, 8px points with a surface ring, 10% area wash, hairline grid.
// Legend for the 2 series. Hover shows all series of one date (index mode).
function drawChart(existing, canvasId, labels, series) {
  if (existing) {
    existing.destroy();
  }
  Chart.defaults.font.family = css('--font-text');
  Chart.defaults.color = css('--graphite');
  const grid = {color: css('--rule'), lineWidth: 1};
  return new Chart($('#' + canvasId), {
    type: 'line',
    data: {
      labels,
      datasets: series.map(s => ({
        label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color + '1a',
        borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: s.color,
        pointBorderColor: css('--sleeve'), pointBorderWidth: 2, tension: 0.25, fill: true,
      })),
    },
    options: {
      responsive: true,
      // The container sets the height (.chart-canvas). Chart.js needs a wrapper with only the canvas.
      maintainAspectRatio: false,
      interaction: {mode: 'index', intersect: false},
      plugins: {
        legend: {align: 'start', labels: {boxWidth: 12, boxHeight: 12, color: css('--paper')}},
        tooltip: {
          backgroundColor: css('--raised'), borderColor: css('--rule-strong'), borderWidth: 1,
          titleColor: css('--paper'), bodyColor: css('--paper'), padding: 10,
        },
      },
      scales: {
        // offset: points sit inside the plot, also when there is only one date
        x: {grid, offset: true, border: {color: css('--rule')}},
        y: {grid, border: {display: false}, beginAtZero: true, ticks: {precision: 0}},
      },
    },
  });
}

$('#groupBy').addEventListener('change', loadDashboard);

// ---- Trades ----
const STEAM_IMAGE_URL = 'https://community.akamai.steamstatic.com/economy/image/';

// Trades of the last load, by trade_id. The detail dialog reads from here.
let tradesById = new Map();

// The card name is the alt text. title only adds a hover tooltip for mouse users.
function itemIcon(item) {
  const name = escapeHtml(item.name || 'Unknown item');
  if (!item.image_url) {
    // No image ID: first letter of the name in a frame, instead of a broken image icon
    return `<span class="thumb-missing" role="img" aria-label="${name}" title="${name}">${escapeHtml((item.name || '?').charAt(0))}</span>`;
  }
  return `<img src="${STEAM_IMAGE_URL}${encodeURIComponent(item.image_url)}" width="32" height="32" alt="${name}" title="${name}">`;
}

// highlightId: trade_id of a new trade. Its row gets a short highlight.
async function loadTrades(highlightId) {
  const filter = $('#tradeFilter').value;
  const q = filter === '' ? '' : `?accepted=${filter}`;
  const trades = await api(`/api/trades${q}`);
  tradesById = new Map(trades.map(t => [String(t.trade_id), t]));
  const tbody = $('#tradesTable tbody');
  tbody.innerHTML = trades.map(t => `
        <tr class="trade-row${t.trade_id === highlightId ? ' row-new' : ''}" data-trade-id="${escapeHtml(String(t.trade_id))}">
            <td><button type="button" class="row-open" aria-label="Details of offer from ${escapeHtml(new Date(t.timestamp).toLocaleString('en-GB'))}">${new Date(t.timestamp).toLocaleString('en-GB')}</button></td>
            <td>${escapeHtml(t.partner_name || t.partner_id || '?')}</td>
            <td class="items-td">${t.items_to_receive.map(itemIcon).join('')}</td>
            <td class="items-td">${t.items_to_give.map(itemIcon).join('')}</td>
            <td>${tradeStatusHtml(t)}</td>
            <td class="reason-td">${reasonListHtml(t.reason, 'reason-list')}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">No offers yet. New offers show up here as soon as the bot checks them.</td></tr>';
}

// Bot decision plus what happened after it (auto decline, manual action).
function tradeStatusHtml(t) {
  const base = t.accepted
      ? '<span class="pill" data-tone="ok">✓ Accepted</span>'
      : t.auto_declined
          ? '<span class="pill" data-tone="bad">⊘ Declined automatically</span>'
          : '<span class="pill" data-tone="warn">! Not accepted</span>';
  const manual = t.manual_action === 'accepted' ? '<span class="pill" data-tone="neutral">Accepted by you</span>'
      : t.manual_action === 'declined' ? '<span class="pill" data-tone="neutral">Declined by you</span>' : '';
  return `<span class="pills">${base}${manual}</span>`;
}

// Stored reasons start with a Discord emoji. The UI lists them without it.
function cleanReason(text) {
  return String(text).replace(/^(\u{1F534}|\u{1F6AB})\s*/u, '');
}

function reasonListHtml(reasons, className) {
  return reasons?.length
      ? `<ul class="${className}">${reasons.map(r => `<li>${escapeHtml(cleanReason(r))}</li>`).join('')}</ul>` : '';
}

// ---- Trade detail dialog ----
// Steam type is e.g. "Portal 2 Foil Trading Card". Game name is the part before.
function gameFromType(type) {
  return (type || '').replace(/ (Foil )?Trading Card$/, '') || '?';
}

// SteamID64 of the bot from /api/status. Null until the bot logged in once.
let botSteamId = null;

// Badge page of the bot. Only visible if the bot profile is public.
function badgeUrl(item, foil) {
  return `https://steamcommunity.com/profiles/${encodeURIComponent(botSteamId)}/gamecards/${encodeURIComponent(item.appId)}/${foil ? '?border=1' : ''}`;
}

// Steam app 753 holds all trading cards. Old trades have no market_hash_name.
// Then use the market search for the card name.
function marketUrl(item) {
  if (item.market_hash_name) {
    return `https://steamcommunity.com/market/listings/753/${encodeURIComponent(item.market_hash_name)}`;
  }
  const params = new URLSearchParams({appid: '753', q: item.name || ''});
  return `https://steamcommunity.com/market/search?${params}`;
}

// Card art. No image ID: an empty frame instead of a broken image icon.
function cardImg(id) {
  return id ? `<img src="${STEAM_IMAGE_URL}${encodeURIComponent(id)}" alt="" loading="lazy">` : '';
}

function itemCard(item) {
  const foil = item.border === 'cardborder_1';
  return `<figure class="card${foil ? ' foil' : ''}">
        <div class="card-frame">${cardImg(item.image_url)}</div>
        <figcaption>
            <div class="card-name">${escapeHtml(item.name || '?')}</div>
            <div class="card-game">${escapeHtml(gameFromType(item.type))}${foil ? ' <span class="badge foil">Foil</span>' : ''}</div>
        </figcaption>
        <div class="card-links">
            ${botSteamId ? `<a class="link-button" href="${escapeHtml(badgeUrl(item, foil))}" target="_blank" rel="noopener noreferrer">Badge</a>` : ''}
            <a class="link-button" href="${escapeHtml(marketUrl(item))}" target="_blank" rel="noopener noreferrer">Market</a>
        </div>
    </figure>`;
}

// flow: 'gets' or 'gives'. The side gets the color rule of the card flow.
function itemSection(title, items, flow) {
  const body = items.length ? items.map(itemCard).join('')
      : '<p class="empty">No cards on this side.</p>';
  return `<section class="trade-side" data-flow="${flow}"><h3>${title} <span class="count">${items.length}</span></h3><div class="card-grid">${body}</div></section>`;
}

// statusHtml: optional. Open offers pass their own status text.
async function openTradeDialog(trade, statusHtml) {
  if (!botSteamId) {
    try {
      botSteamId = (await api('/api/status')).botSteamId;
    } catch (err) {
      console.error('Could not load bot SteamID', err);
    }
  }
  const status = statusHtml ?? tradeStatusHtml(trade);
  const reason = reasonListHtml(trade.reason, 'reason-list trade-reason');
  $('#tradeDialogBody').innerHTML = `
        <div class="trade-meta">
            <span>${new Date(trade.timestamp).toLocaleString('en-GB')}</span>
            <span>${escapeHtml(trade.partner_name || trade.partner_id || '?')}</span>
            ${status}
        </div>
        ${reason}
        <div class="trade-sides">
            ${itemSection('Bot gets', trade.items_to_receive, 'gets')}
            ${itemSection('Bot gives', trade.items_to_give, 'gives')}
        </div>`;
  $('#tradeDialog').showModal();
}

function openTradeFromRow(target) {
  const row = target.closest('tr[data-trade-id]');
  const trade = row && tradesById.get(row.dataset.tradeId);
  if (trade) {
    openTradeDialog(trade);
  }
}

// Keyboard users use the button in the time cell. A click anywhere on the row is a mouse shortcut.
$('#tradesTable tbody').addEventListener('click', e => openTradeFromRow(e.target));

// Light dismiss: closedby="any" on the dialog. Fallback for browsers without it (Safari).
// Test the pointer position, not event.target: the dialog is also the target for its own padding.
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', e => { pressedOutside = outside(e, dialog); });
    // Press and release outside, so a text selection drag that ends on the backdrop does not close it
    dialog.addEventListener('pointerup', e => {
      if (pressedOutside && outside(e, dialog)) {
        dialog.close();
      }
    });
  }
}

$('#reloadTrades').addEventListener('click', () => loadTrades());
$('#tradeFilter').addEventListener('change', () => loadTrades());

// ---- Open offers ----
// Offers of the last load, by trade_id
let offersById = new Map();

function offerStatusText(o) {
  if (!o.checked) {
    return 'Not checked by the bot';
  }
  if (o.manual_action === 'accepted') {
    return 'Accepted by you, waiting for confirmation';
  }
  if (o.accepted) {
    return 'Accepted by the bot, waiting for confirmation';
  }
  return 'Needs your decision';
}

function offerStatusPill(o) {
  const tone = !o.checked ? 'neutral' : (o.accepted || o.manual_action === 'accepted') ? 'ok' : 'warn';
  return `<span class="pill" data-tone="${tone}">${escapeHtml(offerStatusText(o))}</span>`;
}

function updateOffersCount(count) {
  const el = $('#offersCount');
  el.textContent = count;
  el.hidden = count === 0;
}

async function loadOffers() {
  const offers = await api('/api/offers/open');
  offersById = new Map(offers.map(o => [o.trade_id, o]));
  updateOffersCount(offers.length);
  $('#offersList').innerHTML = offers.map(o => {
    const id = escapeHtml(o.trade_id);
    const time = o.timestamp ? new Date(o.timestamp).toLocaleString('en-GB') : '?';
    const side = (title, items, flow) => `<div class="offer-side" data-flow="${flow}">
          <h3>${title} <span class="count">${items.length}</span></h3>
          <div class="thumbs">${items.map(itemIcon).join('') || '<span class="empty">Nothing</span>'}</div>
        </div>`;
    return `<article class="offer" data-trade-id="${id}" aria-labelledby="offer-${id}">
        <header class="offer-head">
          <h2 id="offer-${id}" class="offer-partner">${escapeHtml(o.partner_name || o.partner_id)}</h2>
          <span class="offer-time">${time}</span>
          ${offerStatusPill(o)}
        </header>
        <div class="offer-items">
          ${side('Bot gets', o.items_to_receive, 'gets')}
          ${side('Bot gives', o.items_to_give, 'gives')}
        </div>
        ${reasonListHtml(o.reason, 'reason-list offer-reasons')}
        <div class="offer-actions">
          <button type="button" data-action="details" class="quiet">Details</button>
          <button type="button" data-action="decline" class="danger">Decline</button>
          <button type="button" data-action="accept" class="primary">Accept</button>
        </div>
      </article>`;
  }).join('') || '<p class="empty">No open offers. New offers show up here as soon as Steam sends them.</p>';
}

async function handleOfferAction(button) {
  const article = button.closest('.offer');
  const offer = offersById.get(article?.dataset.tradeId);
  if (!offer) {
    return;
  }
  const action = button.dataset.action;
  if (action === 'details') {
    openTradeDialog(offer, offerStatusPill(offer));
    return;
  }
  const who = offer.partner_name || offer.partner_id;
  const cards = `The bot gets ${offer.items_to_receive.length} and gives ${offer.items_to_give.length} items.`;
  const ok = action === 'accept'
      ? await confirmAction('Accept offer?', `Offer from ${who}. ${cards}`
          + (offer.reason?.length ? ` The bot found ${offer.reason.length} problem(s). The rules are not checked again.` : ''), 'Accept')
      : await confirmAction('Decline offer?', `Offer from ${who}. ${cards} This cannot be undone.`, 'Decline', {danger: true});
  if (!ok) {
    return;
  }
  // Disabled buttons show the pending state. The status region only gets the result.
  article.querySelectorAll('button').forEach(b => { b.disabled = true; });
  $('#offersMsg').textContent = '';
  try {
    await post(`/api/offers/${encodeURIComponent(offer.trade_id)}/${action}`);
    $('#offersMsg').textContent = action === 'accept'
        ? 'Offer accepted. The bot confirms it with the mobile authenticator. Discord shows the result.'
        : 'Offer declined.';
    await loadOffers();
  } catch (err) {
    $('#offersMsg').textContent = `Could not ${action} the offer: ${err.message}`;
    article.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
}

$('#offersList').addEventListener('click', e => {
  const button = e.target.closest('button[data-action]');
  if (button) {
    handleOfferAction(button);
  }
});
$('#reloadOffers').addEventListener('click',
    () => loadOffers().catch(err => { $('#offersMsg').textContent = 'Error: ' + err.message; }));

// ---- Inventory ----
let invData = null;
// Set sizes that are loading or failed. Stops repeated requests.
const setSizeRequests = new Map();

const PROTECTION_BADGES = {
  never_give: '<span class="badge never">Never give</span>',
  duplicates_only: '<span class="badge protected">Duplicates only</span>',
};

function setProgressHtml(set) {
  if (!set.setSize) {
    const state = setSizeRequests.get(set.appId);
    const note = state === 'loading' ? 'loading set size…' : state === 'failed' ? 'set size unknown' : 'set size not loaded';
    return `<span class="set-progress">${set.distinct} / ? <span class="hint">(${note})</span></span>`;
  }
  const complete = set.distinct >= set.setSize;
  const label = `${set.distinct} of ${set.setSize} cards`;
  return `<span class="set-progress"><progress max="${set.setSize}" value="${Math.min(set.distinct, set.setSize)}" aria-label="Set progress: ${label}"></progress>
      ${set.distinct} / ${set.setSize}${complete ? ' ✔ complete' : ''}</span>`;
}

function setSummaryHtml(set) {
  return `<span class="set-name">${escapeHtml(set.game)}${set.foil ? ' <span class="badge foil">Foil</span>' : ''}
      ${PROTECTION_BADGES[set.protection] || ''}</span>
      ${setProgressHtml(set)}
      <span class="set-dupes">${set.duplicates} duplicate${set.duplicates === 1 ? '' : 's'}</span>`;
}

// Duplicates are drawn as a stack (up to 3 layers). The count is also text.
function inventoryCardHtml(card, foil) {
  const notTradable = card.count - card.tradable;
  const copies = card.count === 1 ? '1 copy' : `${card.count} copies`;
  return `<figure class="card${foil ? ' foil' : ''}" data-stack="${Math.min(card.count, 3)}">
      <div class="card-frame">${cardImg(card.image_url)}</div>
      <figcaption>
        <div class="card-name">${escapeHtml(card.name)}</div>
        <div class="card-game">${copies}${notTradable > 0 ? `, ${notTradable} not tradable` : ''}</div>
      </figcaption>
      ${card.count > 1 ? `<span class="card-count" aria-hidden="true">×${card.count}</span>` : ''}
    </figure>`;
}

// Owned cards, then one empty slot per missing card (when the set size is known).
function setGridHtml(set) {
  const missing = set.setSize ? Math.max(0, set.setSize - set.distinct) : 0;
  const slots = Array.from({length: missing}, () => '<div class="card slot" aria-hidden="true"><span>Missing</span></div>').join('');
  const note = missing ? `<p class="visually-hidden">${missing} cards of this set are missing.</p>` : '';
  return set.cards.map(c => inventoryCardHtml(c, set.foil)).join('') + slots + note;
}

function filteredSets() {
  const q = $('#invSearch').value.trim().toLowerCase();
  const onlyProtected = $('#invProtected').checked;
  const onlyDupes = $('#invDuplicates').checked;
  return invData.sets.filter(set => (!onlyProtected || set.protection)
      && (!onlyDupes || set.duplicates > 0)
      && (!q || set.game.toLowerCase().includes(q)
          || set.cards.some(c => c.name.toLowerCase().includes(q))));
}

function renderInventory() {
  const sets = filteredSets();
  const totals = invData.sets.reduce((a, s) => ({
    cards: a.cards + s.total,
    dupes: a.dupes + s.duplicates,
    complete: a.complete + (s.setSize && s.distinct >= s.setSize ? 1 : 0),
  }), {cards: 0, dupes: 0, complete: 0});
  $('#invSummary').innerHTML = [
    tile(formatNumber(invData.sets.length), 'Sets'),
    tile(formatNumber(totals.cards), 'Cards'),
    tile(formatNumber(totals.dupes), 'Duplicates'),
    tile(formatNumber(totals.complete), 'Complete sets'),
  ].join('');
  $('#invList').innerHTML = sets.map(set => `
      <details class="set" data-index="${set.index}" data-app-id="${escapeHtml(set.appId)}">
        <summary>${setSummaryHtml(set)}</summary>
        <div class="card-grid"></div>
      </details>`).join('') || '<p class="empty">No set matches the search and filters.</p>';
  announceInventory(`Loaded ${new Date(invData.loadedAt).toLocaleTimeString('en-GB')}. Showing ${sets.length} of ${invData.sets.length} sets.`);
}

// The status region changes on each key in the search field. Debounce it,
// so a screen reader reads only the final count.
let invMsgTimer = null;
function announceInventory(text) {
  clearTimeout(invMsgTimer);
  invMsgTimer = setTimeout(() => { $('#invMsg').textContent = text; }, 500);
}

// Re-render the summaries of all sets of one app (normal and foil).
function refreshSetSummaries(appId) {
  document.querySelectorAll(`#invList details[data-app-id="${CSS.escape(appId)}"]`).forEach(el => {
    const set = invData.sets[Number(el.dataset.index)];
    el.querySelector('summary').innerHTML = setSummaryHtml(set);
    // Open sets also get their empty slots once the size is known
    if (el.open) {
      el.querySelector('.card-grid').innerHTML = setGridHtml(set);
    }
  });
}

// Returns 'ok', 'failed' or 'skipped' (already loading or failed before).
async function loadSetSize(appId) {
  if (setSizeRequests.has(appId)) {
    return 'skipped';
  }
  setSizeRequests.set(appId, 'loading');
  refreshSetSummaries(appId);
  let result;
  try {
    const {size} = await api(`/api/inventory/set-size/${encodeURIComponent(appId)}`);
    invData.sets.filter(s => s.appId === appId).forEach(s => { s.setSize = size; });
    setSizeRequests.delete(appId);
    result = 'ok';
  } catch (err) {
    console.warn(`Set size of ${appId} failed`, err);
    setSizeRequests.set(appId, 'failed');
    result = 'failed';
  }
  refreshSetSummaries(appId);
  updateSizeLoaderButton();
  return result;
}

// ---- Load all missing set sizes ----
// One after the other with a pause, so Steam does not rate limit the bot.
// Sizes in the database come with /api/inventory and are not loaded again.
const SIZE_LOAD_PAUSE_MS = 1500;
const SIZE_LOAD_MAX_FAILS_IN_ROW = 3;
let sizeRun = null; // { stopped } while a run is active

function missingSizeAppIds() {
  return invData ? [...new Set(invData.sets.filter(s => !s.setSize).map(s => s.appId))] : [];
}

function updateSizeLoaderButton() {
  const button = $('#loadAllSizes');
  if (sizeRun) {
    button.textContent = 'Stop loading';
    button.disabled = false;
    return;
  }
  const count = missingSizeAppIds().length;
  button.disabled = count === 0;
  button.textContent = count === 0 ? 'All set sizes known'
      : `Load ${count} missing set size${count === 1 ? '' : 's'}`;
}

async function loadAllSetSizes() {
  // A new run also retries sets that failed before
  const appIds = missingSizeAppIds();
  appIds.forEach(id => { if (setSizeRequests.get(id) === 'failed') setSizeRequests.delete(id); });
  const run = {stopped: false};
  sizeRun = run;
  const data = invData;
  let done = 0, loaded = 0, failed = 0, failsInRow = 0;
  const progress = $('#sizeProgress');
  const text = $('#sizeProgressText');
  progress.max = appIds.length;
  progress.value = 0;
  progress.hidden = text.hidden = false;
  updateSizeLoaderButton();

  for (const appId of appIds) {
    // Stop button, or Refresh replaced the inventory data
    if (run.stopped || invData !== data) {
      break;
    }
    const result = await loadSetSize(appId);
    done++;
    if (result === 'failed') {
      failed++;
      failsInRow++;
    } else if (result === 'ok') {
      loaded++;
      failsInRow = 0;
    }
    progress.value = done;
    text.textContent = `${done} of ${appIds.length}${failed ? `, ${failed} failed` : ''}`;
    if (failsInRow >= SIZE_LOAD_MAX_FAILS_IN_ROW) {
      run.stopped = 'errors';
      break;
    }
    if (result !== 'skipped' && done < appIds.length) {
      await new Promise(resolve => setTimeout(resolve, SIZE_LOAD_PAUSE_MS));
    }
  }

  sizeRun = null;
  progress.hidden = text.hidden = true;
  updateSizeLoaderButton();
  if (invData === data) {
    renderInventory();
  }
  clearTimeout(invMsgTimer);
  $('#invMsg').textContent = run.stopped === 'errors'
      ? `Stopped after ${SIZE_LOAD_MAX_FAILS_IN_ROW} failed set sizes in a row. Steam may limit requests. Try again in a few minutes. ${loaded} loaded.`
      : run.stopped
          ? `Stopped. ${loaded} set sizes loaded.`
          : `${loaded} of ${appIds.length} set sizes loaded${failed ? `, ${failed} failed. Press the button again to retry them` : ''}.`;
}

$('#loadAllSizes').addEventListener('click', () => {
  if (sizeRun) {
    sizeRun.stopped = true;
    return;
  }
  loadAllSetSizes().catch(err => console.error('Loading set sizes failed', err));
});

async function loadInventory(refresh = false) {
  // Loading state: native indeterminate <progress>, not a "Loading…" text in the live region
  $('#invLoading').hidden = false;
  $('#reloadInventory').disabled = true;
  try {
    invData = await api(`/api/inventory${refresh ? '?refresh=1' : ''}`);
  } catch (err) {
    clearTimeout(invMsgTimer);
    $('#invMsg').textContent = 'Error: ' + err.message;
    return;
  } finally {
    $('#invLoading').hidden = true;
    $('#reloadInventory').disabled = false;
  }
  invData.sets.forEach((set, i) => { set.index = i; });
  renderInventory();
  updateSizeLoaderButton();
  // Protected sets are few. Load their sizes one after the other, so Steam is not flooded.
  const missing = [...new Set(invData.sets.filter(s => s.protection && !s.setSize).map(s => s.appId))];
  for (const appId of missing) {
    await loadSetSize(appId);
  }
}

// Cards and set size load when a set opens. 'toggle' does not bubble, so listen in capture phase.
$('#invList').addEventListener('toggle', e => {
  const el = e.target;
  if (!el.matches('details.set') || !el.open) {
    return;
  }
  const set = invData.sets[Number(el.dataset.index)];
  const grid = el.querySelector('.card-grid');
  if (!grid.childElementCount) {
    grid.innerHTML = setGridHtml(set);
  }
  if (!set.setSize) {
    loadSetSize(set.appId);
  }
}, true);

$('#invSearch').addEventListener('input', () => invData && renderInventory());
$('#invProtected').addEventListener('change', () => invData && renderInventory());
$('#invDuplicates').addEventListener('change', () => invData && renderInventory());
$('#reloadInventory').addEventListener('click', () => {
  // A running size load stops. It works on the old inventory data.
  if (sizeRun) {
    sizeRun.stopped = true;
  }
  setSizeRequests.clear();
  loadInventory(true);
});

// ---- Live updates ----
// Server pushes an event for each new trade (accepted or declined).
// Reload only the open tab. Other tabs load fresh data on tab switch.
function reloadActiveView(highlightId) {
  const active = activePanelId();
  const load = active === 'trades' ? loadTrades(highlightId)
      : active === 'dashboard' ? loadDashboard()
          : active === 'offers' ? loadOffers() : null;
  load?.catch(err => console.error('Live reload failed', err));
  // The tab badge shows the count also when another tab is open.
  if (active !== 'offers') {
    refreshOffersCount();
  }
}

// Bursts of events (e.g. several offers change in one poll) cause one request only.
let offersCountTimer = null;
function refreshOffersCount() {
  clearTimeout(offersCountTimer);
  offersCountTimer = setTimeout(() => {
    api('/api/offers/open').then(o => updateOffersCount(o.length))
        .catch(err => console.error('Offer count failed', err));
  }, 1000);
}

const liveEvents = new EventSource('/api/events');
liveEvents.addEventListener('trade', (e) => {
  const {trade_id} = JSON.parse(e.data);
  reloadActiveView(trade_id);
});
// Offer state changed on Steam (accepted, declined, canceled, ...)
liveEvents.addEventListener('offer', () => reloadActiveView());
// After a reconnect (e.g. bot restart) events can be missed. Reload once.
let liveConnectedOnce = false;
liveEvents.addEventListener('open', () => {
  if (liveConnectedOnce) {
    reloadActiveView();
  }
  liveConnectedOnce = true;
});

// ---- Config ----
const LABELS = {
  port: 'Port',
  steam_username: 'Steam username',
  steam_password: 'Steam password',
  steam_shared_secret: 'Shared Secret',
  steam_identity_secret: 'Identity Secret',
  steam_api_key: 'Steam API Key',
  steam_main_account: 'Main account (SteamID64)',
  discord_webhook_id: 'Discord Webhook ID',
  discord_webhook_token: 'Discord Webhook Token',
  uptimekuma_url: 'Uptime Kuma URL',
  uptimekuma_key: 'Uptime Kuma Key',
  prometheus_prefix: 'Prometheus prefix',
  sale_cards_give_1_for_3_app_ids: 'Sale cards: give 1, get 3',
  sale_card_get_1_for_2_app_id: 'Sale card: get 1, give 2',
  blocked_app_ids: 'Blocked',
  never_give_app_ids: 'Never give',
  never_get_app_ids: 'Never get',
  only_same_set_swap_app_ids: 'Only same-set swaps',
  only_give_1_for_2_app_ids: 'Only give 1 for 2',
  only_get_cross_set_app_ids: 'Only get in cross-set trades',
  give_only_duplicates_app_ids: 'Give only duplicates',
  auto_decline_clear_cases: 'Auto decline clear cases',
  ignore_messages_from: 'Ignore messages from',
  web_ui_enabled: 'Web UI enabled',
  web_host: 'Web Host',
  web_auth_token: 'Web Auth Token',
};

// Help text under a field. Tells which trades are still allowed.
// "Same-set swap": same game and same type (normal or foil), 1:1, 2:2, ...
const HINTS = {
  sale_cards_give_1_for_3_app_ids: 'Bot gives a card of these games only for 3 cards of other games (same type). '
      + 'Allowed: same-set swaps, give 1 get 3, give 2 get 6, ...',
  sale_card_get_1_for_2_app_id: 'One App ID. For each card of this game the bot gets, it gives 2 cards of other games (same type). '
      + 'Allowed: get 1 give 2, get 2 give 4, ... and same-set swaps.',
  only_same_set_swap_app_ids: 'Same game and type, 1:1, 2:2, ...',
  only_give_1_for_2_app_ids: 'Bot gives 1 of these cards and gets 2 cards of other games (2 for 4, ...).',
  only_get_cross_set_app_ids: 'Bot gets these cards in cross-set trades. The other cards it gets can be of any game. Example: get 1 of this game + 1 of game B, give 1 of game C.',
  never_give_app_ids: 'Removes swap and give.',
  never_get_app_ids: 'Removes swap and get.',
  blocked_app_ids: 'Removes all trade kinds.',
  give_only_duplicates_app_ids: 'Bot keeps at least 1 copy of each card it gives. Applies to swap and give.',
  auto_decline_clear_cases: 'Bot declines clear cases by itself: it would give a non-card item, a card of a game it never gives, '
      + 'or only last copies of protected cards in an N:N offer. Other declined offers stay open for a manual check.',
  ignore_messages_from: 'SteamID64s. Chat messages from them are not forwarded and get no reply.',
};

// Config groups by topic. Fields without a group go to "Other".
const CONFIG_GROUPS = [
  {
    title: 'Set rules',
    intro: 'Rules per game (App IDs). A game can be in more than one list. '
        + 'The bot applies the steps in this order. The table below shows the result.',
    full: true,
    // Steps in the order the bot applies them. See setRules.js.
    steps: [
      {
        title: 'Allow',
        kind: 'allow',
        intro: 'Game in no "Only" list: all trade kinds are allowed. '
            + 'Game in "Only" lists: only the trade kinds of these lists are allowed.',
        keys: ['only_same_set_swap_app_ids', 'only_give_1_for_2_app_ids', 'only_get_cross_set_app_ids'],
      },
      {
        title: 'Remove',
        kind: 'remove',
        intro: 'Applied last. Removes trade kinds, also if an "Only" list allows them.',
        keys: ['never_give_app_ids', 'never_get_app_ids', 'blocked_app_ids'],
      },
      {
        title: 'Limit giving',
        kind: 'limit',
        intro: 'Extra check for the trade kinds that are left.',
        keys: ['give_only_duplicates_app_ids'],
      },
    ],
  },
  {
    title: 'Trade rules',
    full: true,
    keys: ['sale_cards_give_1_for_3_app_ids', 'sale_card_get_1_for_2_app_id',
      'auto_decline_clear_cases', 'ignore_messages_from']
  },
  {
    title: 'Steam',
    keys: ['steam_username', 'steam_password', 'steam_shared_secret',
      'steam_identity_secret', 'steam_api_key', 'steam_main_account']
  },
  {
    title: 'Notifications & monitoring',
    keys: ['discord_webhook_id', 'discord_webhook_token', 'uptimekuma_url',
      'uptimekuma_key', 'prometheus_prefix']
  },
  {
    title: 'Web UI',
    keys: ['web_ui_enabled', 'port', 'web_host', 'web_auth_token']
  },
];

// Wide fields use the full row of the group.
const WIDE_FIELDS = new Set(['ignore_messages_from']);

async function loadConfig() {
  const {fields} = await api('/api/config');
  const byKey = new Map(fields.map(f => [f.key, f]));
  const groups = CONFIG_GROUPS.map(g => ({
    title: g.title,
    intro: g.intro,
    full: g.full,
    steps: g.steps && g.steps.map(step => ({
      ...step,
      fields: step.keys.map(k => byKey.get(k)).filter(Boolean),
    })),
    fields: groupKeys(g).map(k => byKey.get(k)).filter(Boolean),
  }));
  const grouped = new Set(CONFIG_GROUPS.flatMap(groupKeys));
  const rest = fields.filter(f => !grouped.has(f.key));
  if (rest.length) {
    groups.push({title: 'Other', fields: rest});
  }
  $('#configFields').innerHTML = groups.filter(g => g.fields.length).map(
      group).join('');
  $('#configMsg').textContent = '';
  renderSetRulePreview();
}

function groupKeys(g) {
  return g.steps ? g.steps.flatMap(step => step.keys) : g.keys;
}

function group({title, intro, full, steps, fields}) {
  // Badge on the group if all fields need a restart
  // or none do. Else badge per field.
  const allRestart = fields.every(f => f.restartRequired);
  const noneRestart = fields.every(f => !f.restartRequired);
  const badge = allRestart ? '<span class="badge restart">Restart</span>'
      : noneRestart ? '<span class="badge hot">applies instantly</span>' : '';
  const showBadge = !allRestart && !noneRestart;
  const introHtml = intro ? `<p class="hint">${escapeHtml(intro)}</p>` : '';
  const body = steps ? ruleSteps(steps, showBadge) + setRulePreviewTable()
      : `<div class="field-grid${full ? ' cols-2' : ''}">${fields.map(
          f => fieldRow(f, showBadge)).join('')}</div>`;
  return `<fieldset class="field-group${full ? ' full'
      : ''}"><legend>${title}${badge}</legend>${introHtml}${body}</fieldset>`;
}

// Numbered steps of the set rules. The list order is the order the bot applies them.
function ruleSteps(steps, showBadge) {
  const items = steps.filter(step => step.fields.length).map(step => `
    <li class="rule-step ${step.kind}">
      <h3 class="rule-step-title">${escapeHtml(step.title)}</h3>
      <p class="hint">${escapeHtml(step.intro)}</p>
      <div class="field-grid cols-3">${step.fields.map(f => fieldRow(f, showBadge)).join('')}</div>
    </li>`).join('');
  return `<ol class="rule-steps">${items}</ol>`;
}

// ---- Set rule preview ----
// Same logic as setRules.js. Shows the result per game while you type.
const SET_RULE_KEYS = {
  onlySwap: 'only_same_set_swap_app_ids',
  onlyGive: 'only_give_1_for_2_app_ids',
  onlyGet: 'only_get_cross_set_app_ids',
  neverGive: 'never_give_app_ids',
  neverGet: 'never_get_app_ids',
  blocked: 'blocked_app_ids',
  duplicatesOnly: 'give_only_duplicates_app_ids',
};
const TRADE_KINDS = [
  {kind: 'swap', only: 'onlySwap', label: 'Swap'},
  {kind: 'give', only: 'onlyGive', label: 'Give 1 for 2'},
  {kind: 'get', only: 'onlyGet', label: 'Get cross-set'},
];
// Rules that remove a trade kind, in the order they apply.
const REMOVERS = [
  {list: 'neverGive', kinds: ['swap', 'give']},
  {list: 'neverGet', kinds: ['swap', 'get']},
  {list: 'blocked', kinds: ['swap', 'give', 'get']},
];

function readSetRuleLists() {
  const lists = {};
  Object.entries(SET_RULE_KEYS).forEach(([name, key]) => {
    const input = document.getElementById(`cfg-${key}`);
    lists[name] = input ? input.value.split(',').map(s => s.trim()).filter(Boolean) : [];
  });
  return lists;
}

// Returns per trade kind: {allowed, reason}. reason = label of the rule that blocks it.
function setRuleResult(appId, lists) {
  const inOnly = TRADE_KINDS.filter(t => lists[t.only].includes(appId));
  const result = {};
  TRADE_KINDS.forEach(t => {
    if (inOnly.length > 0 && !inOnly.includes(t)) {
      result[t.kind] = {allowed: false, reason: 'not in an "Only" list'};
      return;
    }
    const remover = REMOVERS.filter(r => lists[r.list].includes(appId) && r.kinds.includes(t.kind)).pop();
    result[t.kind] = remover
        ? {allowed: false, reason: LABELS[SET_RULE_KEYS[remover.list]], removed: true}
        : {allowed: true};
  });
  return result;
}

function setRulePreviewTable() {
  const head = TRADE_KINDS.map(t => `<th scope="col">${t.label}</th>`).join('');
  return `
    <div class="table-wrap rule-preview" tabindex="0" role="region" aria-labelledby="rulePreviewCaption">
      <table>
        <caption id="rulePreviewCaption">Result per game</caption>
        <thead><tr><th scope="col">App ID</th>${head}<th scope="col">Note</th></tr></thead>
        <tbody id="rulePreviewBody"></tbody>
      </table>
    </div>`;
}

function renderSetRulePreview() {
  const body = document.getElementById('rulePreviewBody');
  if (!body) {
    return;
  }
  const lists = readSetRuleLists();
  const ids = [...new Set(Object.values(lists).flat())]
      .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  if (ids.length === 0) {
    body.innerHTML = `<tr><td colspan="${TRADE_KINDS.length + 2}" class="empty">No game in a set rule. All trade kinds are allowed for all games.</td></tr>`;
    return;
  }
  body.innerHTML = ids.map(appId => {
    const result = setRuleResult(appId, lists);
    const cells = TRADE_KINDS.map(t => {
      const r = result[t.kind];
      if (r.allowed) {
        return '<td class="kind yes"><span aria-hidden="true">✓</span> allowed</td>';
      }
      const cls = r.removed ? 'removed' : 'no';
      return `<td class="kind ${cls}"><span aria-hidden="true">✗</span> ${escapeHtml(r.reason)}</td>`;
    }).join('');
    const notes = [];
    const nothing = TRADE_KINDS.every(t => !result[t.kind].allowed);
    if (nothing && !lists.blocked.includes(appId)) {
      notes.push('<span class="badge never">Nothing allowed</span>');
    }
    if (lists.duplicatesOnly.includes(appId) && (result.swap.allowed || result.give.allowed)) {
      notes.push('<span class="badge protected">Gives only duplicates</span>');
    }
    return `<tr><th scope="row">${escapeHtml(appId)}</th>${cells}<td>${notes.join(' ')}</td></tr>`;
  }).join('');
}

$('#configFields').addEventListener('input', (e) => {
  if (Object.values(SET_RULE_KEYS).some(key => e.target.id === `cfg-${key}`)) {
    renderSetRulePreview();
  }
});

function fieldRow(f, showBadge) {
  const label = LABELS[f.key] || f.key;
  const id = `cfg-${f.key}`;
  const badge = showBadge && f.restartRequired
      ? '<span class="badge restart">Restart</span>' : '';
  const wide = WIDE_FIELDS.has(f.key) ? ' wide' : '';
  const hintId = `${id}-hint`;
  const hint = HINTS[f.key]
      ? `<small class="field-hint" id="${hintId}">${escapeHtml(HINTS[f.key])}</small>` : '';
  const describedBy = HINTS[f.key] ? ` aria-describedby="${hintId}"` : '';
  if (typeof f.value === 'boolean') {
    return `<div class="field-row checkbox-row${wide}"><label for="${id}"><input type="checkbox" id="${id}" name="${f.key}"${describedBy} ${f.value
        ? 'checked' : ''}> ${label}${badge}</label>${hint}</div>`;
  }
  let input;
  if (f.secret) {
    input = `<input type="password" id="${id}" name="${f.key}"${describedBy} autocomplete="new-password" placeholder="${f.isSet
        ? '•••••• (set)' : 'not set'}">`;
  } else {
    const val = Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? '');
    input = `<input type="text" id="${id}" name="${f.key}"${describedBy} autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" value="${escapeHtml(
        String(val))}">`;
  }
  return `<div class="field-row${wide}"><label for="${id}">${label}${badge}</label>${input}${hint}</div>`;
}

$('#configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {};
  for (const el of form.elements) {
    if (!el.name) {
      continue;
    }
    if (el.type === 'checkbox') {
      payload[el.name] = el.checked;
    } else if (el.type === 'password') {
      if (el.value) {
        payload[el.name] = el.value;
      }
    } else {
      payload[el.name] = el.value;
    }
  }
  try {
    const res = await api('/api/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    $('#configMsg').textContent = res.restartRequired
    && res.restartRequired.length
        ? `Saved. Restart required for: ${res.restartRequired.join(
            ', ')}`
        : 'Saved and applied.';
    await loadConfig();
  } catch (err) {
    $('#configMsg').textContent = 'Error: ' + err.message;
  }
});

// ---- Status ----
async function loadStatus() {
  const s = await api('/api/status');
  setBotState(s.loggedOn);
  const items = [
    ['Steam login', s.loggedOn ? '● Logged in' : '○ Logged out'],
    ['Uptime', formatUptime(s.uptimeMs)],
    ['Reconnect attempts', s.reconnectAttempts],
    ['Last heartbeat',
      s.lastHeartbeat ? new Date(s.lastHeartbeat).toLocaleString('en-GB')
          : '—'],
    ['Last error', s.lastError ? `${s.lastError.message}` : '—'],
  ];
  $('#statusInfo').innerHTML = items.map(([k, v]) =>
      `<div class="status-item"><div class="k">${k}</div><div class="v">${escapeHtml(
          String(v))}</div></div>`).join('');
}

$('#reloadStatus').addEventListener('click', loadStatus);

// Auto refresh every 10 s. Only when the status tab is open and the page is visible.
const STATUS_REFRESH_MS = 10 * 1000;
setInterval(() => {
  if (document.hidden || $('#status').hidden) {
    return;
  }
  loadStatus().catch(err => console.error('Status refresh failed', err));
}, STATUS_REFRESH_MS);

function formatUptime(ms) {
  if (!ms) {
    return '—';
  }
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
      m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

// ---- Header ----
function setBotState(loggedOn) {
  const el = $('#botState');
  el.dataset.state = loggedOn ? 'online' : 'offline';
  el.textContent = loggedOn ? 'Bot online' : 'Bot offline';
}

function refreshBotState() {
  if (document.hidden) {
    return;
  }
  api('/api/status').then(s => setBotState(s.loggedOn)).catch(err => console.error('Bot state failed', err));
}

setInterval(refreshBotState, 30 * 1000);
refreshBotState();
// Sign out only makes sense when a password is set
api('/api/session').then(s => { $('#signOut').hidden = !s.authEnabled; })
    .catch(err => console.error('Session info failed', err));

// initial
loadDashboard();
refreshOffersCount();
