import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Bot } from '../src/bot.js';
import { loadConfig } from '../src/config.js';

class FakeFeed extends EventEmitter {
  watched = new Set();
  start() {}
  stop() {}
  watch(m) { this.watched.add(m); }
  unwatch(m) { this.watched.delete(m); }
}

function setup(env = {}) {
  const cfg = loadConfig({ WATCH_SECONDS: '9999', ...env });
  const feed = new FakeFeed();
  const orders = [];
  const notes = [];
  const clock = { t: 1_000_000 };
  const bot = new Bot({
    cfg,
    feed,
    trader: {
      buy: async (mint, sol) => (orders.push(['buy', mint, sol]), { signature: 's' }),
      sell: async (mint) => (orders.push(['sell', mint]), { signature: 's' }),
    },
    notifier: { send: async (title, body) => notes.push(`${title} ${body}`) },
    price: { get: async () => 100 },
    now: () => clock.t,
  });
  bot.start();
  clearInterval(bot.timer);
  return { bot, feed, orders, notes, clock };
}

const create = (mint, extra = {}) => ({ txType: 'create', mint, name: 'Coin', symbol: 'C', traderPublicKey: 'dev', solAmount: 1, marketCapSol: 30, ...extra });

/** Simule une activité saine : n acheteurs distincts, mcap finale donnée. */
function pump(feed, mint, n = 30, mcap = 80) {
  for (let i = 0; i < n; i++) feed.emit('trade', { txType: 'buy', mint, traderPublicKey: `w${i}`, solAmount: 0.5, marketCapSol: mcap });
}

test('achète 5 € sur un token prometteur', async () => {
  const { bot, feed, orders, notes } = setup();
  feed.emit('create', create('A'));
  pump(feed, 'A');
  await bot.decide('A');
  assert.deepEqual(orders, [['buy', 'A', 0.05]]); // 5 € / 100 €/SOL
  assert.ok(bot.positions.has('A'));
  assert.match(notes[0], /Achat 5 €/);
  bot.stop();
});

test("n'achète pas un token sans traction, ni si le créateur a vendu", async () => {
  const { bot, feed, orders } = setup();
  feed.emit('create', create('A'));
  pump(feed, 'A', 3);
  await bot.decide('A');
  feed.emit('create', create('B'));
  pump(feed, 'B');
  feed.emit('trade', { txType: 'sell', mint: 'B', traderPublicKey: 'dev', solAmount: 1, marketCapSol: 80 });
  await bot.decide('B');
  assert.equal(orders.length, 0);
  assert.equal(feed.watched.size, 0);
  bot.stop();
});

test('ignore un token dont un seul wallet fait le volume', async () => {
  const { bot, feed, orders } = setup();
  feed.emit('create', create('A'));
  pump(feed, 'A', 15);
  feed.emit('trade', { txType: 'buy', mint: 'A', traderPublicKey: 'whale', solAmount: 20, marketCapSol: 90 });
  await bot.decide('A');
  assert.equal(orders.length, 0);
  bot.stop();
});

test('take profit et stop loss', async () => {
  const { bot, feed, orders } = setup();
  for (const m of ['A', 'B']) {
    feed.emit('create', create(m));
    pump(feed, m);
    await bot.decide(m);
  }
  feed.emit('trade', { txType: 'buy', mint: 'A', traderPublicKey: 'x', solAmount: 1, marketCapSol: 170 });
  feed.emit('trade', { txType: 'sell', mint: 'B', traderPublicKey: 'x', solAmount: 1, marketCapSol: 40 });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(orders.slice(2), [['sell', 'A'], ['sell', 'B']]);
  assert.equal(bot.positions.size, 0);
  assert.ok(Math.abs(bot.realizedEur - (5 * 1.125 - 5 * 0.5)) < 1e-9);
  bot.stop();
});

test('respecte le budget journalier et le nombre max de positions', async () => {
  const { bot, feed, orders } = setup({ DAILY_BUDGET_EUR: '10', MAX_OPEN_POSITIONS: '10' });
  for (const m of ['A', 'B', 'C']) {
    feed.emit('create', create(m));
    pump(feed, m);
    await bot.decide(m);
  }
  assert.equal(orders.length, 2);
  bot.stop();
});

test('notifie chaque migration et vend la position concernée', async () => {
  const { bot, feed, orders, notes } = setup();
  feed.emit('create', create('A'));
  pump(feed, 'A');
  await bot.decide('A');
  feed.emit('create', create('Z', { name: 'Zed', symbol: 'Z' }));
  await bot.onMigration({ txType: 'migrate', mint: 'Z' });
  await bot.onMigration({ txType: 'migrate', mint: 'A' });
  assert.match(notes[1], /MIGRÉ : Zed \(\$Z\)/);
  assert.match(notes[2], /MIGRÉ : Coin .*Tu as une position/s);
  assert.deepEqual(orders.at(-1), ['sell', 'A']);
  bot.stop();
});

test('vend après la durée maximale', async () => {
  const { bot, feed, orders, clock } = setup();
  feed.emit('create', create('A'));
  pump(feed, 'A');
  await bot.decide('A');
  clock.t += 31 * 60_000;
  bot.checkTimeouts();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(orders.at(-1), ['sell', 'A']);
  bot.stop();
});

test('un achat échoué ne consomme pas le budget', async () => {
  const { bot, feed, notes } = setup();
  bot.trader.buy = async () => { throw new Error('boom'); };
  feed.emit('create', create('A'));
  pump(feed, 'A');
  await bot.decide('A');
  assert.equal(bot.positions.size, 0);
  assert.equal(bot.buyTimes.length, 0);
  assert.match(notes[0], /Achat échoué/);
  bot.stop();
});
