const config = require('./config.json');
const logger = require('./logger');

const discordWebhookURL = `https://discord.com/api/webhooks/${config.discord_webhook_id}/${config.discord_webhook_token}`;
let discordMessageBuilder = [];

function sendDiscordMessage(message) {
    fetch(discordWebhookURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: message,
        username: 'SteamTradeBot'
      })
    })
    .then(response => {
      if (response.ok) logger.info('Discord message send!');
      else logger.error(`Error while sending Discord message: ${response.statusText}`);
    })
    .catch(error => logger.error(error));
}

module.exports = { discordMessageBuilder, sendDiscordMessage };
