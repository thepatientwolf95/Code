// Exécution des ordres. PaperTrader simule ; LiveTrader signe localement une
// transaction construite par PumpPortal (la clé privée ne quitte jamais la machine).

export class PaperTrader {
  async buy(mint, sol) {
    return { signature: 'paper' };
  }
  async sell(mint) {
    return { signature: 'paper' };
  }
}

export class LiveTrader {
  constructor(cfg) {
    this.cfg = cfg;
  }

  async #init() {
    if (this.keypair) return;
    const { Connection, Keypair, VersionedTransaction } = await import('@solana/web3.js');
    const { default: bs58 } = await import('bs58');
    this.VersionedTransaction = VersionedTransaction;
    this.keypair = Keypair.fromSecretKey(bs58.decode(this.cfg.walletPrivateKey));
    this.conn = new Connection(this.cfg.rpcUrl, 'confirmed');
  }

  async #trade(params) {
    await this.#init();
    const res = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        publicKey: this.keypair.publicKey.toBase58(),
        slippage: this.cfg.slippagePct,
        priorityFee: this.cfg.priorityFeeSol,
        pool: 'auto',
        ...params,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`PumpPortal HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const tx = this.VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
    tx.sign([this.keypair]);
    const signature = await this.conn.sendTransaction(tx, { maxRetries: 3 });
    const bh = await this.conn.getLatestBlockhash();
    const conf = await this.conn.confirmTransaction({ signature, ...bh }, 'confirmed');
    if (conf.value.err) throw new Error(`Transaction échouée: ${JSON.stringify(conf.value.err)}`);
    return { signature };
  }

  buy(mint, sol) {
    return this.#trade({ action: 'buy', mint, amount: sol, denominatedInSol: 'true' });
  }

  sell(mint) {
    return this.#trade({ action: 'sell', mint, amount: '100%', denominatedInSol: 'false' });
  }
}
