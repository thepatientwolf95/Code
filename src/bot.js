import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyTrade, evaluate, newStats } from './scorer.js';

const link = (mint) => `https://pump.fun/coin/${mint}`;
const HOUR = 3600_000;

export class Bot {
  constructor({ cfg, feed, trader, notifier, price, stateFile = null, now = () => Date.now() }) {
    Object.assign(this, { cfg, feed, trader, notifier, price, stateFile, now });
    this.watching = new Map(); // mint -> stats (phase d'observation)
    this.positions = new Map(); // mint -> position ouverte
    this.names = new Map(); // mint -> "NOM ($SYM)" pour les notifications de migration
    this.buyTimes = []; // horodatages des achats (limites horaire / journalière)
    this.busy = new Set(); // mints avec un ordre en cours
    this.realizedEur = 0;
    this.#load();
  }

  start() {
    this.feed.on('create', (m) => this.onCreate(m));
    this.feed.on('trade', (m) => this.onTrade(m));
    this.feed.on('migration', (m) => this.onMigration(m));
    this.feed.on('warn', (w) => console.warn(w));
    this.feed.on('open', () => console.log('Connecté au flux — en attente de nouveaux tokens…'));
    for (const mint of this.positions.keys()) this.feed.watch(mint);
    this.feed.start();
    this.timer = setInterval(() => this.checkTimeouts(), 15_000);
  }

  onCreate(m) {
    const label = `${m.name || '?'} ($${m.symbol || '?'})`;
    this.names.set(m.mint, label);
    if (this.names.size > 20_000) this.names.delete(this.names.keys().next().value);

    if (this.watching.size >= this.cfg.maxWatched || this.positions.has(m.mint)) return;
    if ((Number(m.solAmount) || 0) > this.cfg.maxDevBuySol) return; // éliminé d'office
    const stats = newStats(m, this.now());
    this.watching.set(m.mint, stats);
    this.feed.watch(m.mint);
    stats.timer = setTimeout(() => this.decide(m.mint), this.cfg.watchSeconds * 1000);
  }

  onTrade(m) {
    const stats = this.watching.get(m.mint);
    if (stats) return applyTrade(stats, m);
    const pos = this.positions.get(m.mint);
    if (!pos || !(Number(m.marketCapSol) > 0)) return;
    pos.mcapSol = Number(m.marketCapSol);
    const pnlPct = (pos.mcapSol / pos.entryMcapSol - 1) * 100;
    if (pnlPct >= this.cfg.takeProfitPct) this.sell(m.mint, `take profit +${pnlPct.toFixed(0)}%`);
    else if (pnlPct <= -this.cfg.stopLossPct) this.sell(m.mint, `stop loss ${pnlPct.toFixed(0)}%`);
  }

  async onMigration(m) {
    const held = this.positions.has(m.mint);
    const label = this.names.get(m.mint) || this.positions.get(m.mint)?.label || m.mint;
    if (held || this.cfg.notifyAllMigrations) {
      await this.notifier.send(
        `🚀 MIGRÉ : ${label}`,
        `${held ? '⭐ Tu as une position sur ce token.\n' : ''}Le token a quitté la bonding curve (onglet « Migré »).\n${m.mint}`,
        link(m.mint),
      );
    }
    if (held && this.cfg.sellOnMigration) await this.sell(m.mint, 'migration');
  }

  /** Fin de la fenêtre d'observation : acheter ou abandonner. */
  async decide(mint) {
    const stats = this.watching.get(mint);
    if (!stats) return;
    clearTimeout(stats.timer);
    this.watching.delete(mint);
    const verdict = evaluate(stats, this.cfg);
    const blocked = verdict.ok ? this.#limitReached() : null;
    if (!verdict.ok || blocked) {
      this.feed.unwatch(mint);
      if (blocked) console.log(`Signal ignoré sur ${stats.symbol} : ${blocked}`);
      return;
    }
    await this.buy(stats, verdict);
  }

  #limitReached() {
    const t = this.now();
    this.buyTimes = this.buyTimes.filter((x) => t - x < 24 * HOUR);
    if (this.positions.size + this.busy.size >= this.cfg.maxOpenPositions) return 'nombre max de positions ouvertes';
    if (this.buyTimes.filter((x) => t - x < HOUR).length >= this.cfg.maxBuysPerHour) return 'limite horaire atteinte';
    if ((this.buyTimes.length + 1) * this.cfg.betEur > this.cfg.dailyBudgetEur) return 'budget journalier atteint';
    return null;
  }

  async buy(stats, verdict) {
    const { mint } = stats;
    const label = `${stats.name} ($${stats.symbol})`;
    this.busy.add(mint);
    this.buyTimes.push(this.now()); // réservé avant l'ordre : pas de dépassement en cas de signaux simultanés
    try {
      const solEur = await this.price.get();
      const sol = Number((this.cfg.betEur / solEur).toFixed(6));
      const { signature } = await this.trader.buy(mint, sol);
      this.positions.set(mint, {
        mint,
        label,
        sol,
        eur: this.cfg.betEur,
        entryMcapSol: stats.mcapSol,
        mcapSol: stats.mcapSol,
        openedAt: this.now(),
        signature,
      });
      this.#save();
      await this.notifier.send(
        `🟢 Achat ${this.cfg.betEur} € : ${label}`,
        `Score ${verdict.score}/100 · ${verdict.buyers} acheteurs · ratio achat/vente ${verdict.ratio.toFixed(1)} · mcap ${stats.mcapSol.toFixed(0)} SOL${this.cfg.mode === 'paper' ? '\n(simulation)' : ''}`,
        link(mint),
      );
    } catch (e) {
      this.buyTimes.pop();
      this.feed.unwatch(mint);
      await this.notifier.send(`⚠️ Achat échoué : ${label}`, e.message);
    } finally {
      this.busy.delete(mint);
    }
  }

  async sell(mint, reason) {
    const pos = this.positions.get(mint);
    if (!pos || this.busy.has(mint)) return;
    this.busy.add(mint);
    try {
      await this.trader.sell(mint);
      const pnlPct = (pos.mcapSol / pos.entryMcapSol - 1) * 100;
      const pnlEur = (pos.eur * pnlPct) / 100;
      this.realizedEur += pnlEur;
      this.positions.delete(mint);
      this.feed.unwatch(mint);
      this.#save();
      await this.notifier.send(
        `${pnlEur >= 0 ? '💰' : '🔴'} Vente : ${pos.label}`,
        `${reason} · ≈ ${pnlEur >= 0 ? '+' : ''}${pnlEur.toFixed(2)} € (estimation hors frais) · total ${this.realizedEur.toFixed(2)} €`,
        link(mint),
      );
    } catch (e) {
      await this.notifier.send(`⚠️ Vente échouée : ${pos.label}`, `${reason} — ${e.message}. Nouvel essai au prochain signal.`);
    } finally {
      this.busy.delete(mint);
    }
  }

  checkTimeouts() {
    const limit = this.cfg.maxHoldMinutes * 60_000;
    for (const pos of this.positions.values()) {
      if (this.now() - pos.openedAt >= limit) this.sell(pos.mint, `durée max ${this.cfg.maxHoldMinutes} min`);
    }
  }

  stop() {
    clearInterval(this.timer);
    for (const s of this.watching.values()) clearTimeout(s.timer);
    this.feed.stop();
  }

  #load() {
    if (!this.stateFile) return;
    try {
      const s = JSON.parse(readFileSync(this.stateFile, 'utf8'));
      if (s.mode !== this.cfg.mode) return; // ne pas mélanger simulation et réel
      for (const p of s.positions || []) this.positions.set(p.mint, p);
      this.buyTimes = s.buyTimes || [];
      this.realizedEur = s.realizedEur || 0;
    } catch {
      // pas d'état précédent
    }
  }

  #save() {
    if (!this.stateFile) return;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(
      this.stateFile,
      JSON.stringify(
        { mode: this.cfg.mode, positions: [...this.positions.values()], buyTimes: this.buyTimes, realizedEur: this.realizedEur },
        null,
        2,
      ),
    );
  }
}
