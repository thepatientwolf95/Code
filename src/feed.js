// Flux temps réel pump.fun via PumpPortal (WebSocket gratuit).
// Une seule connexion, reconnexion automatique, réabonnement aux tokens suivis.
import { EventEmitter } from 'node:events';

const URL = 'wss://pumpportal.fun/api/data';

export class Feed extends EventEmitter {
  constructor(url = URL) {
    super();
    this.url = url;
    this.tokens = new Set();
    this.backoff = 1000;
    this.closed = false;
  }

  start() {
    const ws = (this.ws = new WebSocket(this.url));
    ws.addEventListener('open', () => {
      this.backoff = 1000;
      this.#send({ method: 'subscribeNewToken' });
      this.#send({ method: 'subscribeMigration' });
      if (this.tokens.size) this.#send({ method: 'subscribeTokenTrade', keys: [...this.tokens] });
      this.emit('open');
    });
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      } catch {
        return;
      }
      if (!m || !m.mint) return; // accusés de réception, erreurs…
      if (m.txType === 'create') this.emit('create', m);
      else if (m.txType === 'migrate' || m.txType === 'migration') this.emit('migration', m);
      else if (m.txType === 'buy' || m.txType === 'sell') this.emit('trade', m);
    });
    ws.addEventListener('error', (e) => this.emit('warn', `WebSocket: ${e.message || 'erreur'}`));
    ws.addEventListener('close', () => {
      if (this.closed) return;
      this.emit('warn', `Flux déconnecté, reconnexion dans ${this.backoff / 1000}s`);
      setTimeout(() => this.start(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30000);
    });
  }

  watch(mint) {
    if (this.tokens.has(mint)) return;
    this.tokens.add(mint);
    this.#send({ method: 'subscribeTokenTrade', keys: [mint] });
  }

  unwatch(mint) {
    if (!this.tokens.delete(mint)) return;
    this.#send({ method: 'unsubscribeTokenTrade', keys: [mint] });
  }

  stop() {
    this.closed = true;
    this.ws?.close();
  }

  #send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
}
