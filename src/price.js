// Cours SOL/EUR (pour convertir la mise de 5 € en SOL), mis en cache 5 min.
export class SolPrice {
  constructor(fallback) {
    this.eur = fallback;
    this.at = 0;
  }

  async get() {
    if (Date.now() - this.at < 5 * 60_000) return this.eur;
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=eur', {
        signal: AbortSignal.timeout(8000),
      });
      const eur = (await r.json())?.solana?.eur;
      if (eur > 0) {
        this.eur = eur;
        this.at = Date.now();
      }
    } catch {
      // on garde la dernière valeur connue
    }
    return this.eur;
  }
}
