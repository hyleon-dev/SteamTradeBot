# SteamTradeBot

A self-hosted Steam bot that checks incoming trade offers for **Steam trading cards** and accepts fair offers automatically.
It reports every offer to Discord, forwards chat messages to your main account and has a web dashboard for statistics, trade history and configuration.

> **Disclaimer:** This project is not affiliated with Valve or Steam. Automated trading is at your own risk.
> Run the bot on a dedicated trade account, not on your main account.

## Features

### Bot
- **Automatic offer validation** with configurable rules (see [Trade rules](#trade-rules)).
- **Automatic accept and mobile confirmation.** The bot confirms trades with the identity secret. Offers where the bot gives nothing need no confirmation.
- **Declined offers stay open.** The bot notifies you on Discord so that you can check the offer manually. Only clear cases are declined automatically, and only if `AUTO_DECLINE_CLEAR_CASES=true`.
- **Chat forwarding.** Friend messages to the bot are forwarded to your main account. The sender gets a reply that points to the main account, at most once per 5 minutes per chat.
- **Discord notifications** for bot start, disconnect, every offer (with the planned card swaps or the reasons for rejection) and failed accepts.
- **Automatic reconnect** after connection loss. Expired web sessions are refreshed.
- **Uptime Kuma** push heartbeat every 60 seconds.
- **Prometheus metrics** at `/metrics`.
- **SQLite storage** for trade history, statistics and chat messages.

### Web UI
| Tab | Content |
|---|---|
| **Dashboard** | Total trades, acceptance rate, cards received and given. Charts over time, grouped by day, week or month. Declined offers per reason (last 7 days, 30 days or all time), plus counts of automatic and manual actions. |
| **Open offers** | Active offers on Steam with the reasons of the bot. Accept or decline them with one click (with a confirm dialog). A manual accept does not check the rules again. Protected cards are still reserved. Each manual action goes to Discord. The tab shows the number of open offers. |
| **Trades** | The last 100 offers with partner, card images, status and decline reason. Shows automatic declines and manual actions. Filter by accepted or declined. Updates **live** when a new offer arrives. |
| **Inventory** | Cards of the bot by set (normal and foil apart), with duplicates and set progress. Filter by name, protected sets or sets with duplicates. The set size comes from the badge page of the bot. It loads when you open a set, or for all sets with "Load missing set sizes" (one after the other, with a pause for Steam). Loaded sizes stay in the database for good. |
| **Config** | All settings, grouped by topic. Trade rules apply instantly. Other settings need a restart. Secrets are masked and never sent to the browser. |
| **Status** | Login state, uptime, reconnect attempts, last heartbeat and last error. Refreshes every 10 seconds. |

## Trade rules

The bot checks each offer in this order. The offer is accepted only if all checks pass.

1. **Trading cards only.** Any other item (gems, backgrounds, CS items, …) declines the offer.
2. **Set rules** (see [Set rules](#set-rules)). A card the bot may not give or get in any way declines the offer.
3. **Same-set swaps.** Cards of the same game and same type (normal or foil) are swapped 1:1, if the set rules allow swaps for that game. Cards left over on one side go to the next steps.
4. **Cross-set cards.** After step 3, a remaining card declines the offer if its game allows only swaps for that side.
   For `GIVE_ONLY_DUPLICATES_APP_IDS` games the bot gives only duplicates. After the trade it must keep at least 1 copy of each given card (normal and foil count separately). The bot loads its inventory for this check. If the inventory does not load, the offer is declined. It does not matter if the bot already owns the card it receives.
   Offers with these cards are checked one after the other. The given cards stay reserved until the trade is done. So two parallel offers cannot both take the last duplicate.
5. **Sale cards** (each rule is active only if its variable is set):
   - **Get:** for each sale card the bot receives (app `SALE_CARD_GET_1_FOR_2_APP_ID`), it gives 2 normal cards.
   - **Give:** for each sale card the bot gives (apps in `SALE_CARDS_GIVE_1_FOR_3_APP_IDS`), it must receive at least 3 cards. Otherwise the offer is declined.
6. **Cross-set ratio.** For all remaining cards: for each card the bot gives, it must receive at least 2 cards of the same type. Normal cards and foils are counted separately.

**Decline reasons:** the bot runs all checks, also after the first problem. The Discord message lists every reason with the cards that cause it. The same reasons are stored with the trade and shown in the trade details.

**Trade hold:** if the partner or the bot has a trade hold, the Discord message shows the days. The offer is not declined because of it.

**Auto decline** (only if `AUTO_DECLINE_CLEAR_CASES=true`): the bot declines clear cases by itself and sends a Discord message. Clear cases are:
- the bot gives an item that is not a trading card,
- the bot gives a card of a game it may not give in any way (e.g. `NEVER_GIVE_APP_IDS`, `BLOCKED_APP_IDS`),
- the offer has the same number of cards on both sides (1:1, 2:2, 3:3, …), and each card the bot gives is the last copy of a card from `GIVE_ONLY_DUPLICATES_APP_IDS`.

All other declined offers stay open for a manual check. For example: wrong ratio, extra items the bot receives, cards the bot may not get, an offer where only some given cards are last copies, or an inventory that does not load.

**Mobile confirmation:** if the confirmation fails, the bot tries again 2 times (every 15 seconds). After that it sends a Discord message.

Example: the bot gives 1 normal card of game A and receives 2 normal cards of game B → accepted.

### Set rules

Each card in an offer is one of 3 trade kinds:

| Trade kind | Meaning |
|---|---|
| **Swap** | Same-set swap: same game and same type, 1:1, 2:2, … |
| **Give** | The bot gives the card in a cross-set trade: give 1, get 2 cards of other games. |
| **Get** | The bot gets the card in a cross-set trade: get 2, give 1 card of another game. |

You can put a game in more than one list. The lists combine like this:

1. No `ONLY_*` list: all 3 kinds are allowed. One or more `ONLY_*` lists: only their kinds are allowed.
2. `NEVER_GIVE_APP_IDS` removes swap and give. `NEVER_GET_APP_IDS` removes swap and get.
3. `BLOCKED_APP_IDS` removes all kinds.

`GIVE_ONLY_DUPLICATES_APP_IDS` is separate: the bot keeps at least 1 copy of each card it gives, in each allowed kind.

Examples:
- `ONLY_SAME_SET_SWAP_APP_IDS` + `ONLY_GIVE_1_FOR_2_APP_IDS`: the bot swaps and gives these cards. Its count of them does not grow.
- `ONLY_SAME_SET_SWAP_APP_IDS` + `GIVE_ONLY_DUPLICATES_APP_IDS`: the bot swaps only duplicates. Add `ONLY_GET_2_FOR_1_APP_IDS` to also collect these cards 2 for 1.

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
| `WEB_AUTH_TOKEN` | Password for the web UI login page. See [Security](#security). | yes |
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
| `SALE_CARDS_GIVE_1_FOR_3_APP_IDS` | Sale cards the bot gives only for 3 cards of other games each (same type). Same-set swaps are allowed. | no |
| `SALE_CARD_GET_1_FOR_2_APP_ID` | One sale card the bot collects. For each one it gets, it gives 2 cards of other games (same type). | no |
| `BLOCKED_APP_IDS` | App IDs the bot never gives and never gets | no |
| `NEVER_GIVE_APP_IDS` | App IDs the bot never gives, also not in same-set swaps | no |
| `NEVER_GET_APP_IDS` | App IDs the bot never gets, also not in same-set swaps | no |
| `ONLY_SAME_SET_SWAP_APP_IDS` | Allows same-set swaps (1:1, 2:2, …). Other kinds only by another `ONLY_*` list. | no |
| `ONLY_GIVE_1_FOR_2_APP_IDS` | Allows to give these cards for 2 cards of other games. Other kinds only by another `ONLY_*` list. | no |
| `ONLY_GET_2_FOR_1_APP_IDS` | Allows to get 2 of these cards for 1 card of another game. Other kinds only by another `ONLY_*` list. | no |
| `GIVE_ONLY_DUPLICATES_APP_IDS` | The bot gives these cards only if it keeps at least 1 copy of each | no |
| `AUTO_DECLINE_CLEAR_CASES` | `true` declines clear cases automatically (see [Trade rules](#trade-rules)). Default: `false` | no |
| `IGNORE_MESSAGES_FROM` | SteamID64s whose chat messages are not forwarded | no |

Lists are comma-separated, e.g. `730,570,440`.

See [Set rules](#set-rules) for how the set lists combine.

Old variable names (`SALE_MARKET_FEE_APP_ID_GIVE`, `SALE_MARKET_FEE_APP_ID_GET`, `DO_NOT_GIVE_HARD`, `DO_NOT_GET_HARD`) still work. The bot shows a warning at start. Rename them to the new names.
`GIVE_ONLY_SAME_SET_DUPLICATES_APP_IDS`, `GET_ONLY_SAME_SET_APP_IDS`, `DO_NOT_GIVE_SOFT` and `DO_NOT_GET_SOFT` were removed. The bot ignores them and shows a warning. Put the games in the new set lists.
The Discord webhook URL has the form `https://discord.com/api/webhooks/<ID>/<TOKEN>`.

Optional environment variables (not in the web UI):
- `DB_PATH`: path of the SQLite database. Default: `metrics.db`
- `CONFIG_ENV_PATH`: path of the env file. Default: `.env`

## Security

- **Without `WEB_AUTH_TOKEN`**, the web UI accepts only requests to `localhost`, `127.0.0.1` or `[::1]`. Requests via another host name get `403`. This protects against DNS rebinding.
- **With `WEB_AUTH_TOKEN`**, the web UI shows its own login page (password only). After sign in, a session cookie (HttpOnly, SameSite=Strict, 30 days) keeps you signed in, also after a restart. A new token signs out all sessions. After 10 wrong passwords, the IP is locked for 15 minutes.
- Scripts can still send the token as basic auth (`Authorization: Basic`, any user name). The server never asks for basic auth, so browsers never show their own login dialog.
- **Write requests** (save config, accept or decline offers) must send `Content-Type: application/json`. Other types get `415`. This protects against CSRF: another website cannot send JSON to the bot without a CORS preflight, and the server allows no CORS.
- **Never expose the web UI to the internet without an HTTPS reverse proxy.** Without HTTPS, the password and the session cookie travel in plain text.
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

All `/api` endpoints need the same auth as the web UI: the session cookie from the login page, or the token as basic auth. Without a session they return `401`. `POST` requests must send `Content-Type: application/json`.

| Endpoint | Description |
|---|---|
| `GET /api/status` | Bot state (login, uptime, reconnects, heartbeat, last error) |
| `GET /api/session` | `{ authEnabled }`: is a password set |
| `GET /api/trades?accepted=&from=&to=&limit=` | Trade history. `from`/`to` in Unix ms. `limit` max 1000, default 100. |
| `GET /api/trades/stats?groupBy=day\|week\|month` | Aggregated trade counts |
| `GET /api/trades/reasons?days=` | Declined offers per reason code, plus counts of automatic and manual actions. Without `days`: all time. |
| `GET /api/offers/open` | Active offers on Steam with the stored check result |
| `POST /api/offers/:id/accept` | Accept an active offer manually (rules are not checked again) |
| `POST /api/offers/:id/decline` | Decline an active offer manually |
| `GET /api/inventory?refresh=1` | Bot cards grouped by set. Cached for 60 seconds, `refresh=1` loads them again. |
| `GET /api/inventory/set-size/:appId` | Number of cards in a set (from the badge page, cached in the database) |
| `GET /api/messages?limit=` | Stored chat messages |
| `GET /api/config` | Current config. Secrets show only if they are set. |
| `POST /api/config` | Update config (JSON body with field keys). Empty secret fields keep the current value. |
| `GET /api/events` | Server-Sent Events stream. Sends `trade` for each new offer and `offer` when an offer changes on Steam. |

These need no session:

| Endpoint | Description |
|---|---|
| `GET /login`, `POST /login` | Login page and form (`password` field). Sets the session cookie. |
| `POST /logout` | Deletes the session cookie |
| `GET /metrics` | Prometheus metrics |

## Development

```sh
npm test       # run the Jest tests
npm run migrate  # migrate an old database (stats table day/month/year/week → timestamp)
```

The migration also runs automatically on start. Stop the bot before you run it manually.

### Project structure

```
index.js                  Bot entry point: Steam login, offers, chat, functions for the web UI
utils.js                  Offer mapping and validation (trade rules, decline reasons)
setRules.js               Set rules per game and how the lists combine
reasons.js                Decline reason codes, codes for old reason texts
reservations.js           Lock and card reservations for duplicates of protected sets
inventory.js              Groups the bot inventory by set, reads set sizes from badge pages
bot.js                    Bridge between web routes and the bot (no circular require)
config.js                 Loads and writes .env, field metadata for the web UI
db.js, migrations.js      SQLite storage and schema migrations
discord.js                Discord webhook
metrics.js                Prometheus metrics
events.js                 Event bus between bot and web server
state.js                  Runtime state for the status page
logger.js                 Winston logger with daily log files
*.test.js                 Jest tests (next to the module they test)
web/server.js             Express server, auth, login and logout
web/auth.js               Signed session cookie for the login
web/login.html            Login page template (rendered by the server)
web/routes/               API routes (status, config, trades, offers, inventory, events, images)
web/public/index.html     Web UI page
web/public/app.js         Web UI logic
web/public/tokens.css     Design tokens and fonts, shared by web UI and login page
web/public/style.css      Web UI styles
web/public/login.css      Login page styles
web/public/login.js       Login page: show or hide the password
web/public/fonts/         Barlow font files (SIL Open Font License, see OFL.txt)
scripts/                  Manual maintenance scripts
```
