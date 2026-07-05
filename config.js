require('dotenv').config();

const parseIds = (str) => (str ? str.split(',').map(s => s.trim()).filter(Boolean) : []);

module.exports = {
    port: process.env.PORT,
    steam_username: process.env.STEAM_USERNAME,
    steam_password: process.env.STEAM_PASSWORD,
    steam_shared_secret: process.env.STEAM_SHARED_SECRET,
    steam_identity_secret: process.env.STEAM_IDENTITY_SECRET,
    steam_api_key: process.env.STEAM_API_KEY,
    steam_main_account: process.env.STEAM_MAIN_ACCOUNT,
    discord_webhook_id: process.env.DISCORD_WEBHOOK_ID,
    discord_webhook_token: process.env.DISCORD_WEBHOOK_TOKEN,
    uptimekuma_url: process.env.UPTIMEKUMA_URL,
    uptimekuma_key: process.env.UPTIMEKUMA_KEY,
    prometheus_prefix: process.env.PROMETHEUS_PREFIX,
    sale_market_fee_app_id_give: parseIds(process.env.SALE_MARKET_FEE_APP_ID_GIVE),
    sale_market_fee_app_id_get: process.env.SALE_MARKET_FEE_APP_ID_GET || null,
    do_not_give_hard: parseIds(process.env.DO_NOT_GIVE_HARD),
    do_not_get_hard: parseIds(process.env.DO_NOT_GET_HARD),
    do_not_give_soft: parseIds(process.env.DO_NOT_GIVE_SOFT),
    do_not_get_soft: parseIds(process.env.DO_NOT_GET_SOFT),
    ignore_messages_from: parseIds(process.env.IGNORE_MESSAGES_FROM),
};
