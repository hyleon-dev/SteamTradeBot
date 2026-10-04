const config = require('./config');
const logger = require('./logger');

const discordWebhookURL = `https://discord.com/api/webhooks/${config.discord_webhook_id}/${config.discord_webhook_token}`;

function sendDiscordMessage(message) {
    fetch(discordWebhookURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: message,
        username: 'SteamTradeBot',
        // Messages contain Steam names and chat text from strangers.
        // Block all mentions, so "@everyone" in a name pings nobody.
        allowed_mentions: { parse: [] }
      })
    })
    .then(response => {
      if (response.ok) logger.info('Discord message send!');
      else logger.error(`Error while sending Discord message: ${response.statusText}`);
    })
    .catch(error => logger.error(error));
}

module.exports = { sendDiscordMessage };
