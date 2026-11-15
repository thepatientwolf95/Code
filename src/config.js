import { existsSync } from 'node:fs';

export function loadConfig(env) {
  if (!env) {
    if (existsSync('.env')) process.loadEnvFile('.env');
    env = process.env;
  }
  const num = (k, d) => {
    const v = env[k];
    if (v === undefined || v === '') return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`Config invalide: ${k}=${v}`);
    return n;
  };
  const bool = (k, d) => (env[k] === undefined || env[k] === '' ? d : /^(1|true|yes|oui)$/i.test(env[k]));

  const cfg = {
    mode: (env.MODE || 'paper').toLowerCase(),
    betEur: num('BET_EUR', 5),
    maxOpenPositions: num('MAX_OPEN_POSITIONS', 5),
    maxBuysPerHour: num('MAX_BUYS_PER_HOUR', 6),
    dailyBudgetEur: num('DAILY_BUDGET_EUR', 30),

    watchSeconds: num('WATCH_SECONDS', 45),
    minScore: num('MIN_SCORE', 70),
    minUniqueBuyers: num('MIN_UNIQUE_BUYERS', 12),
    minBuySellRatio: num('MIN_BUY_SELL_RATIO', 1.5),
    minMcapSol: num('MIN_MCAP_SOL', 40),
    maxMcapSol: num('MAX_MCAP_SOL', 150),
    maxDevBuySol: num('MAX_DEV_BUY_SOL', 3),
    maxTopBuyerShare: num('MAX_TOP_BUYER_SHARE', 0.4),
    maxWatched: num('MAX_WATCHED', 150),

    takeProfitPct: num('TAKE_PROFIT_PCT', 100),
    stopLossPct: num('STOP_LOSS_PCT', 40),
    maxHoldMinutes: num('MAX_HOLD_MINUTES', 30),
    sellOnMigration: bool('SELL_ON_MIGRATION', true),

    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || '',
    ntfyTopic: env.NTFY_TOPIC || '',
    notifyAllMigrations: bool('NOTIFY_ALL_MIGRATIONS', true),

    walletPrivateKey: env.WALLET_PRIVATE_KEY || '',
    rpcUrl: env.RPC_URL || 'https://api.mainnet-beta.solana.com',
    slippagePct: num('SLIPPAGE_PCT', 15),
    priorityFeeSol: num('PRIORITY_FEE_SOL', 0.0005),
    solEurFallback: num('SOL_EUR_FALLBACK', 150),
  };
  if (!['paper', 'live'].includes(cfg.mode)) throw new Error('MODE doit être "paper" ou "live"');
  if (cfg.mode === 'live' && !cfg.walletPrivateKey) throw new Error('MODE=live nécessite WALLET_PRIVATE_KEY');
  if (cfg.betEur <= 0) throw new Error('BET_EUR doit être > 0');
  return cfg;
}
