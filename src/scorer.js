// Évalue si un nouveau token "est susceptible de décoller" à partir de son
// activité pendant la fenêtre d'observation. Heuristique, pas une garantie.

export function newStats(create, now) {
  return {
    mint: create.mint,
    name: create.name || '?',
    symbol: create.symbol || '?',
    dev: create.traderPublicKey || '',
    devBuySol: Number(create.solAmount) || 0,
    createdAt: now,
    mcapSol: Number(create.marketCapSol) || 0,
    buys: 0,
    sells: 0,
    buySol: 0,
    sellSol: 0,
    buyers: new Map(), // wallet -> SOL acheté
    devSold: false,
  };
}

export function applyTrade(stats, t) {
  const sol = Number(t.solAmount) || 0;
  if (Number(t.marketCapSol) > 0) stats.mcapSol = Number(t.marketCapSol);
  if (t.txType === 'buy') {
    stats.buys++;
    stats.buySol += sol;
    stats.buyers.set(t.traderPublicKey, (stats.buyers.get(t.traderPublicKey) || 0) + sol);
  } else if (t.txType === 'sell') {
    stats.sells++;
    stats.sellSol += sol;
    if (t.traderPublicKey && t.traderPublicKey === stats.dev) stats.devSold = true;
  }
}

/** @returns {{ok: boolean, score: number, reasons: string[]}} */
export function evaluate(stats, cfg) {
  const reasons = [];
  const buyers = [...stats.buyers.keys()].filter((w) => w !== stats.dev).length;
  const ratio = stats.buySol / Math.max(stats.sellSol, 0.01);
  const topShare = stats.buySol > 0 ? Math.max(0, ...stats.buyers.values()) / stats.buySol : 1;

  // Filtres éliminatoires
  if (stats.devSold) reasons.push('le créateur a vendu');
  if (stats.devBuySol > cfg.maxDevBuySol) reasons.push(`achat créateur trop gros (${stats.devBuySol.toFixed(2)} SOL)`);
  if (stats.mcapSol < cfg.minMcapSol) reasons.push(`market cap trop faible (${stats.mcapSol.toFixed(0)} SOL)`);
  if (stats.mcapSol > cfg.maxMcapSol) reasons.push(`market cap déjà trop haute (${stats.mcapSol.toFixed(0)} SOL)`);
  if (buyers < cfg.minUniqueBuyers) reasons.push(`pas assez d'acheteurs (${buyers})`);
  if (ratio < cfg.minBuySellRatio) reasons.push(`pression vendeuse (ratio ${ratio.toFixed(2)})`);
  if (topShare > cfg.maxTopBuyerShare) reasons.push(`achats trop concentrés (${(topShare * 100).toFixed(0)}%)`);

  // Score 0-100 : acheteurs uniques (40), ratio achat/vente (30), dispersion (30)
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const score = Math.round(
    40 * clamp(buyers / (cfg.minUniqueBuyers * 2.5)) +
      30 * clamp(ratio / (cfg.minBuySellRatio * 3)) +
      30 * clamp(1 - topShare),
  );
  if (score < cfg.minScore) reasons.push(`score insuffisant (${score}/${cfg.minScore})`);
  return { ok: reasons.length === 0, score, reasons, buyers, ratio, topShare };
}
