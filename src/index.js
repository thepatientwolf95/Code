import { Bot } from './bot.js';
import { loadConfig } from './config.js';
import { Feed } from './feed.js';
import { Notifier } from './notify.js';
import { SolPrice } from './price.js';
import { LiveTrader, PaperTrader } from './trader.js';

const cfg = loadConfig();
const notifier = new Notifier(cfg);
const bot = new Bot({
  cfg,
  feed: new Feed(),
  trader: cfg.mode === 'live' ? new LiveTrader(cfg) : new PaperTrader(),
  notifier,
  price: new SolPrice(cfg.solEurFallback),
  stateFile: 'data/state.json',
});

console.log(`Mode: ${cfg.mode === 'live' ? 'LIVE (argent réel)' : 'PAPER (simulation)'} · mise ${cfg.betEur} € · budget ${cfg.dailyBudgetEur} €/jour`);
if (!cfg.telegramToken && !cfg.ntfyTopic) console.warn('Aucun canal de notification configuré (Telegram ou ntfy) : affichage console uniquement.');

bot.start();
await notifier.send('🤖 Bot démarré', `Mode ${cfg.mode}, mise ${cfg.betEur} €`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    bot.stop();
    process.exit(0);
  });
}
