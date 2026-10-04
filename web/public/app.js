const $ = (sel) => document.querySelector(sel);

async function api(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

// ---- Tabs ----
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(
        b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(
        p => p.classList.remove('active'));
    btn.classList.add('active');
    $('#' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'dashboard') {
      loadDashboard();
    }
    if (btn.dataset.tab === 'trades') {
      loadTrades();
    }
    if (btn.dataset.tab === 'config') {
      loadConfig();
    }
    if (btn.dataset.tab === 'status') {
      loadStatus();
    }
  });
});

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
  $('#tiles').innerHTML = [
    tile(totals.trades, 'Total trades'),
    tile(`${rate}%`, 'Acceptance rate'),
    tile(totals.gained, 'Cards received'),
    tile(totals.given, 'Cards given'),
  ].join('');

  tradesChart = drawChart(tradesChart, 'tradesChart', labels, [
    {label: 'Trades', data: data.map(d => d.trades), color: '#4f8cff'},
    {
      label: 'Accepted',
      data: data.map(d => d.accepted || 0),
      color: '#37c871'
    },
  ], 'Trades over time');

  cardsChart = drawChart(cardsChart, 'cardsChart', labels, [
    {label: 'Received', data: data.map(d => d.gained || 0), color: '#37c871'},
    {label: 'Given', data: data.map(d => d.given || 0), color: '#e0a05a'},
  ], 'Cards over time');
}

function tile(value, label) {
  return `<div class="tile"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}

function drawChart(existing, canvasId, labels, series, title) {
  if (existing) {
    existing.destroy();
  }
  return new Chart($('#' + canvasId), {
    type: 'line',
    data: {
      labels,
      datasets: series.map(s => ({
        label: s.label, data: s.data, borderColor: s.color,
        backgroundColor: s.color + '33', tension: 0.25, fill: true,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        title: {display: true, text: title, color: '#e6ebf5'},
        legend: {labels: {color: '#8a97ad'}}
      },
      scales: {
        x: {ticks: {color: '#8a97ad'}, grid: {color: '#2c3650'}},
        y: {
          ticks: {color: '#8a97ad'},
          grid: {color: '#2c3650'},
          beginAtZero: true
        },
      },
    },
  });
}

$('#groupBy').addEventListener('change', loadDashboard);

// ---- Trades ----
// highlightId: trade_id of a new trade. Its row gets a short highlight.
async function loadTrades(highlightId) {
  const filter = $('#tradeFilter').value;
  const q = filter === '' ? '' : `?accepted=${filter}`;
  const trades = await api(`/api/trades${q}`);
  const tbody = $('#tradesTable tbody');
  tbody.innerHTML = trades.map(t => `
        <tr${t.trade_id === highlightId ? ' class="row-new"' : ''}>
            <td>${new Date(t.timestamp).toLocaleString('en-GB')}</td>
            <td>${escapeHtml(t.partner_name || t.partner_id || '?')}</td>
            <td class="items-td">${t.items_to_receive.map(item => `<img src="https://community.akamai.steamstatic.com/economy/image/${item.image_url}" width="32" height="32" alt="" title="${escapeHtml(item.name || '')}">`).join('')}</td>
            <td class="items-td">${t.items_to_give.map(item => `<img src="https://community.akamai.steamstatic.com/economy/image/${item.image_url}" width="32" height="32" alt="" title="${escapeHtml(item.name || '')}">`).join('')}</td>
            <td class="${t.accepted ? 'status-accepted'
      : 'status-declined'}">${t.accepted ? '✅ Accepted' : '❌ Declined'}</td>
            <td>${t.reason ? escapeHtml(t.reason.join('; ')) : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6">No trades</td></tr>';
}
/*
<td className="items-td">${t.items_to_receive.map(item => `<img src="/images/${encodeURIComponent(item.image_url)}" width="32" height="32" alt="" title="${escapeHtml(item.name || '')}">`).join('')}</td>
<td className="items-td">${t.items_to_give.map(item => `<img src="/images/${encodeURIComponent(item.image_url)}" width="32" height="32" alt="" title="${escapeHtml(item.name || '')}">`).join('')}</td>
*/

$('#reloadTrades').addEventListener('click', () => loadTrades());
$('#tradeFilter').addEventListener('change', () => loadTrades());

// ---- Live updates ----
// Server pushes an event for each new trade (accepted or declined).
// Reload only the open tab. Other tabs load fresh data on tab switch.
function reloadActiveView(highlightId) {
  const active = document.querySelector('.panel.active')?.id;
  const load = active === 'trades' ? loadTrades(highlightId)
      : active === 'dashboard' ? loadDashboard() : null;
  load?.catch(err => console.error('Live reload failed', err));
}

const liveEvents = new EventSource('/api/events');
liveEvents.addEventListener('trade', (e) => {
  const {trade_id} = JSON.parse(e.data);
  reloadActiveView(trade_id);
});
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
  sale_market_fee_app_id_give: 'Sale app IDs (give)',
  sale_market_fee_app_id_get: 'Sale app ID (get)',
  do_not_give_hard: 'Hard blacklist (give)',
  do_not_get_hard: 'Hard blacklist (get)',
  do_not_give_soft: 'Soft blacklist (give)',
  do_not_get_soft: 'Soft blacklist (get)',
  ignore_messages_from: 'Ignore messages from',
  web_ui_enabled: 'Web UI enabled',
  web_host: 'Web Host',
  web_auth_token: 'Web Auth Token',
};

// Config groups by topic. Fields without a group go to "Other".
const CONFIG_GROUPS = [
  {
    title: 'Trade rules',
    // Full width. give/get as pairs in 2 columns.
    full: true,
    keys: ['sale_market_fee_app_id_give', 'sale_market_fee_app_id_get',
      'do_not_give_hard', 'do_not_get_hard', 'do_not_give_soft',
      'do_not_get_soft', 'ignore_messages_from']
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
    full: g.full,
    fields: g.keys.map(k => byKey.get(k)).filter(Boolean),
  }));
  const grouped = new Set(CONFIG_GROUPS.flatMap(g => g.keys));
  const rest = fields.filter(f => !grouped.has(f.key));
  if (rest.length) {
    groups.push({title: 'Other', fields: rest});
  }
  $('#configFields').innerHTML = groups.filter(g => g.fields.length).map(
      group).join('');
  $('#configMsg').textContent = '';
}

function group({title, full, fields}) {
  // Badge on the group if all fields need a restart
  // or none do. Else badge per field.
  const allRestart = fields.every(f => f.restartRequired);
  const noneRestart = fields.every(f => !f.restartRequired);
  const badge = allRestart ? '<span class="badge restart">Restart</span>'
      : noneRestart ? '<span class="badge hot">applies instantly</span>' : '';
  const rows = fields.map(f => fieldRow(f, !allRestart && !noneRestart)).join(
      '');
  return `<fieldset class="field-group${full ? ' full'
      : ''}"><legend>${title}${badge}</legend><div class="field-grid${full
      ? ' cols-2' : ''}">${rows}</div></fieldset>`;
}

function fieldRow(f, showBadge) {
  const label = LABELS[f.key] || f.key;
  const id = `cfg-${f.key}`;
  const badge = showBadge && f.restartRequired
      ? '<span class="badge restart">Restart</span>' : '';
  const wide = WIDE_FIELDS.has(f.key) ? ' wide' : '';
  if (typeof f.value === 'boolean') {
    return `<div class="field-row checkbox-row${wide}"><label for="${id}"><input type="checkbox" id="${id}" name="${f.key}" ${f.value
        ? 'checked' : ''}> ${label}${badge}</label></div>`;
  }
  let input;
  if (f.secret) {
    input = `<input type="password" id="${id}" name="${f.key}" autocomplete="new-password" placeholder="${f.isSet
        ? '•••••• (set)' : 'not set'}">`;
  } else {
    const val = Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? '');
    input = `<input type="text" id="${id}" name="${f.key}" autocomplete="off" value="${escapeHtml(
        String(val))}">`;
  }
  return `<div class="field-row${wide}"><label for="${id}">${label}${badge}</label>${input}</div>`;
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
  const items = [
    ['Logged in', s.loggedOn ? '🟢 yes' : '🔴 no'],
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
  if (document.hidden || !$('#status').classList.contains('active')) {
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

// initial
loadDashboard();
