# SteamTradeBot

A self-hosted Steam bot that checks incoming trade offers for **Steam trading cards** and accepts fair offers automatically.
It reports every offer to Discord, forwards chat messages to your main account and has a web dashboard for statistics, trade history and configuration.

> **Disclaimer:** This project is not affiliated with Valve or Steam. Automated trading is at your own risk.
> Run the bot on a dedicated trade account, not on your main account.

## Features

### Bot
- **Automatic offer validation** with configurable rules (see [Trade rules](#trade-rules)).
- **Automatic accept and mobile confirmation.** The bot confirms trades with the identity secret. Offers where the bot gives nothing need no confirmation.
- **Declined offers stay open.** The bot does not decline anything. It notifies you on Discord so that you can check the offer manually.
- **Chat forwarding.** Friend messages to the bot are forwarded to your main account. The sender gets a reply that points to the main account.
- **Discord notifications** for bot start, disconnect, every offer (with the planned card swaps or the reasons for rejection) and failed accepts.
- **Automatic reconnect** after connection loss. Expired web sessions are refreshed.
- **Uptime Kuma** push heartbeat every 60 seconds.
- **Prometheus metrics** at `/metrics`.
- **SQLite storage** for trade history, statistics and chat messages.

### Web UI
| Tab | Content |
|---|---|
| **Dashboard** | Total trades, acceptance rate, cards received and given. Charts over time, grouped by day, week or month. |
| **Trades** | The last 100 offers with partner, card images, status and decline reason. Filter by accepted or declined. Updates **live** when a new offer arrives. |
| **Config** | All settings, grouped by topic. Trade rules apply instantly. Other settings need a restart. Secrets are masked and never sent to the browser. |
| **Status** | Login state, uptime, reconnect attempts, last heartbeat and last error. Refreshes every 10 seconds. |

## Trade rules

The bot checks each offer in this order. The offer is accepted only if all checks pass.

1. **Trading cards only.** Any other item (gems, backgrounds, CS items, …) declines the offer.
2. **Hard blacklist.** A card from a hard-blacklisted game in the offer declines it (`DO_NOT_GIVE_HARD` / `DO_NOT_GET_HARD`).
3. **1:1 swaps of the same game.** Cards of the same game and same type (normal or foil) are swapped 1:1. These swaps are always fine, also for soft-blacklisted games.
4. **Soft blacklist.** After step 3, a remaining card from a soft-blacklisted game declines the offer (`DO_NOT_GIVE_SOFT` / `DO_NOT_GET_SOFT`).
5. **Sale cards** (only active if `SALE_MARKET_FEE_APP_ID_GET` is set):
   - **Get:** for each sale card the bot receives (app `SALE_MARKET_FEE_APP_ID_GET`), it gives 2 normal cards.
   - **Give:** for each sale card the bot gives (apps in `SALE_MARKET_FEE_APP_ID_GIVE`), it must receive at least 3 cards. Otherwise the offer is declined.
6. **Cross-set ratio.** For all remaining cards: for each card the bot gives, it must receive at least 2 cards of the same type. Normal cards and foils are counted separately.

Example: the bot gives 1 normal card of game A and receives 2 normal cards of game B → accepted.

## Requirements

- **Node.js 20 or newer** (required by `better-sqlite3`).
- A **Steam account** for the bot with the **Steam Guard Mobile Authenticator** enabled. You need its `shared_secret` and `identity_secret` (e.g. from the maFile of [Steam Desktop Authenticator](https://github.com/Jessecar96/SteamDesktopAuthenticator)).
- A **Steam Web API key**: <https://steamcommunity.com/dev/apikey>
- A **Discord webhook**.
- Optional: [Uptime Kuma](https://github.com/louislam/uptime-kuma) push monitor, Prometheus, [PM2](https://pm2.keymetrics.io/).

## Installation

```sh
git clone https://github.com/hyleon-dev/SteamTradeBot.git
cd SteamTradeBot
npm install
cp .env.template .env
```

Fill in `.env` (see [Configuration](#configuration)), then start the bot:

```sh
npm run dev            # run in the foreground
npm run dev:headless   # run without web UI (only /metrics)
npm start              # run with PM2 (needs a global PM2 install: npm i -g pm2)
npm stop               # stop the PM2 process
```

The PM2 setup in `ecosystem.config.js` restarts the bot every day at 03:00 and on memory use above 500 MB.

## Configuration

All settings are in `.env`. You can also change them in the **Config** tab of the web UI.

| Variable | Description | Restart |
|---|---|---|
| `PORT` | Port of the web UI and `/metrics`. **Required.** | yes |
| `WEB_UI_ENABLED` | `false` disables the web UI. `/metrics` stays available. Default: `true` | yes |
| `WEB_HOST` | Bind address. Default: `127.0.0.1` | yes |
| `WEB_AUTH_TOKEN` | Password for the web UI (basic auth, any user name). See [Security](#security). | yes |
| `STEAM_USERNAME` | Login name of the bot account | yes |
| `STEAM_PASSWORD` | Password of the bot account | yes |
| `STEAM_SHARED_SECRET` | Shared secret, used to create Steam Guard codes | yes |
| `STEAM_IDENTITY_SECRET` | Identity secret, used to confirm trades | yes |
| `STEAM_API_KEY` | Steam Web API key, used to load profile names | yes |
| `STEAM_MAIN_ACCOUNT` | SteamID64 of your main account. Chat messages are forwarded to it. | yes |
| `DISCORD_WEBHOOK_ID` | ID part of the Discord webhook URL | yes |
| `DISCORD_WEBHOOK_TOKEN` | Token part of the Discord webhook URL | yes |
| `UPTIMEKUMA_URL` | Base URL of Uptime Kuma, e.g. `https://kuma.example.com` | yes |
| `UPTIMEKUMA_KEY` | Push key of the Uptime Kuma monitor | yes |
| `PROMETHEUS_PREFIX` | Prefix for metric names. Default: `steamtradebot` | yes |
| `SALE_MARKET_FEE_APP_ID_GIVE` | App IDs of sale cards the bot may give (3:1) | no |
| `SALE_MARKET_FEE_APP_ID_GET` | App ID of the sale card the bot collects (1:2) | no |
| `DO_NOT_GIVE_HARD` | App IDs the bot never gives | no |
| `DO_NOT_GET_HARD` | App IDs the bot never receives | no |
| `DO_NOT_GIVE_SOFT` | App IDs the bot gives only in 1:1 swaps of the same game | no |
| `DO_NOT_GET_SOFT` | App IDs the bot receives only in 1:1 swaps of the same game | no |
| `IGNORE_MESSAGES_FROM` | SteamID64s whose chat messages are not forwarded | no |

Lists are comma-separated, e.g. `730,570,440`.
The Discord webhook URL has the form `https://discord.com/api/webhooks/<ID>/<TOKEN>`.

Optional environment variables (not in the web UI):
- `DB_PATH`: path of the SQLite database. Default: `metrics.db`
- `CONFIG_ENV_PATH`: path of the env file. Default: `.env`

## Security

- **Without `WEB_AUTH_TOKEN`**, the web UI accepts only requests to `localhost`, `127.0.0.1` or `[::1]`. Requests via another host name get `403`. This protects against DNS rebinding.
- **With `WEB_AUTH_TOKEN`**, the web UI uses basic auth. After 10 wrong passwords, the IP is locked for 15 minutes.
- **Never expose the web UI to the internet without an HTTPS reverse proxy.** Basic auth sends the token in plain text.
- `/metrics` needs no login. It shows only trade counts and process metrics.
- **Never commit** `.env`, maFiles or the database. `.gitignore` covers these files.

## Monitoring

### Prometheus

`GET /metrics` returns the default Node.js process metrics and these values (with prefix, e.g. `STEAMTRADEBOT_TRADES_TODAY`):

| Metric | Description |
|---|---|
| `TOTAL_TRADES`, `TOTAL_CARDS_GIVEN`, `TOTAL_CARDS_GAINED` | All time |
| `TRADES_THIS_YEAR`, `CARDS_GIVEN_THIS_YEAR`, `CARDS_GAINED_THIS_YEAR` | Current year |
| `TRADES_THIS_MONTH`, `CARDS_GIVEN_THIS_MONTH`, `CARDS_GAINED_THIS_MONTH` | Current month |
| `TRADES_TODAY`, `CARDS_GIVEN_TODAY`, `CARDS_GAINED_TODAY` | Current day |
| `CURRENT_RUN_ERRORS` | Steam client errors since start |
| `CURRENT_RUN_RECONNECTS` | Reconnects since start |

The trade metrics count only trades that were accepted and confirmed.

### Logs

The bot writes daily log files to `logs/`:

| File | Content |
|---|---|
| `info-YYYY-MM-DD.log` | Info messages only |
| `debug-YYYY-MM-DD.log` | All levels |
| `error-YYYY-MM-DD.log` | Errors only |
| `crash-YYYY-MM-DD.log` | Uncaught exceptions and unhandled rejections |

## HTTP API

All endpoints except `/metrics` need the same auth as the web UI.

| Endpoint | Description |
|---|---|
| `GET /api/status` | Bot state (login, uptime, reconnects, heartbeat, last error) |
| `GET /api/trades?accepted=&from=&to=&limit=` | Trade history. `from`/`to` in Unix ms. `limit` max 1000, default 100. |
| `GET /api/trades/stats?groupBy=day\|week\|month` | Aggregated trade counts |
| `GET /api/messages?limit=` | Stored chat messages |
| `GET /api/config` | Current config. Secrets show only if they are set. |
| `POST /api/config` | Update config (JSON body with field keys). Empty secret fields keep the current value. |
| `GET /api/events` | Server-Sent Events stream. Sends a `trade` event for each new offer. |
| `GET /metrics` | Prometheus metrics |

## Development

```sh
npm test       # run the Jest tests
npm run migrate  # migrate an old database (stats table day/month/year/week → timestamp)
```

The migration also runs automatically on start. Stop the bot before you run it manually.

### Project structure

```
index.js              Bot entry point: Steam login, offers, chat
utils.js              Offer mapping and validation (trade rules)
config.js             Loads and writes .env, field metadata for the web UI
db.js, migrations.js  SQLite storage and schema migrations
discord.js            Discord webhook
metrics.js            Prometheus metrics
events.js             Event bus between bot and web server
state.js              Runtime state for the status page
logger.js             Winston logger with daily log files
web/server.js         Express server and auth
web/routes/           API routes
web/public/           Web UI (HTML, CSS, JS)
scripts/              Manual maintenance scripts
```
