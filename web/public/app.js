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
    tile(totals.trades, 'Trades gesamt'),
    tile(`${rate}%`, 'Annahmequote'),
    tile(totals.gained, 'Karten erhalten'),
    tile(totals.given, 'Karten gegeben'),
  ].join('');

  tradesChart = drawChart(tradesChart, 'tradesChart', labels, [
    {label: 'Trades', data: data.map(d => d.trades), color: '#4f8cff'},
    {
      label: 'Angenommen',
      data: data.map(d => d.accepted || 0),
      color: '#37c871'
    },
  ], 'Trades über Zeit');

  cardsChart = drawChart(cardsChart, 'cardsChart', labels, [
    {label: 'Erhalten', data: data.map(d => d.gained || 0), color: '#37c871'},
    {label: 'Gegeben', data: data.map(d => d.given || 0), color: '#e0a05a'},
  ], 'Karten über Zeit');
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
async function loadTrades() {
  const filter = $('#tradeFilter').value;
  const q = filter === '' ? '' : `?accepted=${filter}`;
  const trades = await api(`/api/trades${q}`);
  const tbody = $('#tradesTable tbody');
  tbody.innerHTML = trades.map(t => `
        <tr>
            <td>${new Date(t.timestamp).toLocaleString('de-DE')}</td>
            <td>${escapeHtml(t.partner_name || t.partner_id || '?')}</td>
            <td>${t.receive_count}</td>
            <td>${t.give_count}</td>
            <td class="${t.accepted ? 'status-accepted'
      : 'status-declined'}">${t.accepted ? '✅ Angenommen' : '❌ Abgelehnt'}</td>
            <td>${t.reason ? escapeHtml(t.reason.join('; ')) : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6">Keine Trades</td></tr>';
}

$('#reloadTrades').addEventListener('click', loadTrades);
$('#tradeFilter').addEventListener('change', loadTrades);

// ---- Config ----
const LABELS = {
  port: 'Port',
  steam_username: 'Steam-Benutzername',
  steam_password: 'Steam-Passwort',
  steam_shared_secret: 'Shared Secret',
  steam_identity_secret: 'Identity Secret',
  steam_api_key: 'Steam API Key',
  steam_main_account: 'Hauptaccount (SteamID64)',
  discord_webhook_id: 'Discord Webhook ID',
  discord_webhook_token: 'Discord Webhook Token',
  uptimekuma_url: 'Uptime Kuma URL',
  uptimekuma_key: 'Uptime Kuma Key',
  prometheus_prefix: 'Prometheus-Prefix',
  sale_market_fee_app_id_give: 'Sale App-IDs (give)',
  sale_market_fee_app_id_get: 'Sale App-ID (get)',
  do_not_give_hard: 'Hard-Blacklist (give)',
  do_not_get_hard: 'Hard-Blacklist (get)',
  do_not_give_soft: 'Soft-Blacklist (give)',
  do_not_get_soft: 'Soft-Blacklist (get)',
  ignore_messages_from: 'Nachrichten ignorieren von',
  web_ui_enabled: 'Web UI aktiv',
  web_host: 'Web Host',
  web_auth_token: 'Web Auth Token',
};

async function loadConfig() {
  const {fields} = await api('/api/config');
  const hot = fields.filter(f => !f.restartRequired);
  const restart = fields.filter(f => f.restartRequired);
  $('#configFields').innerHTML =
      group('Handel-Regeln (sofort aktiv)', hot) +
      group('Verbindung & Secrets (Neustart nötig)', restart);
  $('#configMsg').textContent = '';
}

function group(title, fields) {
  return `<div class="field-group"><h3>${title}</h3>${fields.map(fieldRow).join(
      '')}</div>`;
}

function fieldRow(f) {
  const label = LABELS[f.key] || f.key;
  const badge = f.restartRequired
      ? '<span class="badge restart">Neustart</span>' : '';
  let input;
  if (f.secret) {
    input = `<input type="password" name="${f.key}" placeholder="${f.isSet
        ? '•••••• (gesetzt)' : 'nicht gesetzt'}">`;
  } else if (typeof f.value === 'boolean') {
    input = `<label><input type="checkbox" name="${f.key}" ${f.value ? 'checked'
        : ''}> aktiv</label>`;
  } else {
    const val = Array.isArray(f.value) ? f.value.join(',') : (f.value ?? '');
    input = `<input type="text" name="${f.key}" value="${escapeHtml(
        String(val))}">`;
  }
  return `<div class="field-row"><label>${label}${badge}</label>${input}</div>`;
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
        ? `Gespeichert. Neustart nötig für: ${res.restartRequired.join(
            ', ')}`
        : 'Gespeichert und sofort aktiv.';
    await loadConfig();
  } catch (err) {
    $('#configMsg').textContent = 'Fehler: ' + err.message;
  }
});

// ---- Status ----
async function loadStatus() {
  const s = await api('/api/status');
  const items = [
    ['Eingeloggt', s.loggedOn ? '🟢 ja' : '🔴 nein'],
    ['Uptime', formatUptime(s.uptimeMs)],
    ['Reconnect-Versuche', s.reconnectAttempts],
    ['Letzter Heartbeat',
      s.lastHeartbeat ? new Date(s.lastHeartbeat).toLocaleString('de-DE')
          : '—'],
    ['Letzter Fehler', s.lastError ? `${s.lastError.message}` : '—'],
  ];
  $('#statusInfo').innerHTML = items.map(([k, v]) =>
      `<div class="status-item"><div class="k">${k}</div><div class="v">${escapeHtml(
          String(v))}</div></div>`).join('');
}

$('#reloadStatus').addEventListener('click', loadStatus);

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
