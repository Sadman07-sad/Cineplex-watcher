# Star Cineplex ticket watcher

Checks Star Cineplex every 20 minutes (GitHub Actions, free) and sends a Telegram message:

1. once when **Avengers: Doomsday** first appears on cineplexbd.com (e.g. Coming Soon), and
2. once when it appears on the booking site ticket.cineplexbd.com (tickets on sale). After that it stops.

It also warns once if the site can't be loaded for ~3 hours, so silence never means "broken".

## Setup

1. **Telegram bot**: in Telegram, message `@BotFather`, send `/newbot`, follow the prompts, copy the token.
   Then open your new bot and press **Start** (a bot can't message you until you do).
2. **Chat id**: message `@userinfobot` in Telegram; it replies with your numeric id.
3. **Secrets**: in the GitHub repo, Settings → Secrets and variables → Actions → New repository secret:
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
4. **Test**: Actions tab → "Star Cineplex watcher" → Run workflow → tick "Only send a Telegram test message".

To reset after it has alerted, set `state.json` back to `{}`.
Change the movie by editing the `MOVIE` regex in `watch.js`.
