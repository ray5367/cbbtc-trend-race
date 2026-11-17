// TrendGuard: a long-only trend bot for the bars-replay/v1 race.
//
// It trades one asset (CBBTC/USDC) on 1-minute bars, speaking the
// agent-fun/bars-replay/v1 protocol through the vendored shim: the harness
// sends hello once, then one batch per bar, and this bot answers every batch
// with exactly one reply carrying its orders for that bar. Orders decided on
// a batch fill at the next bar's open, so every rule below reads only bars
// already closed: no lookahead, no network, no clock, no randomness.
//
// Why this shape: a full-size round trip pays about 26-34 bps in fees,
// slippage and pool impact, and the pool's price moves in steps with long
// flat bars, so fast signals churn the account to death — on the dev window
// every multi-trade trend and breakout rule lost money, while one early
// entry held patiently made money. This bot therefore takes at most one
// filled position per run and protects it, instead of trading often:
//
//   - Indicators, per symbol over its own bars (a batch with no bar for the
//     symbol adds nothing and triggers no decision): EMA(5) and EMA(13) over
//     closes, each seeded at the first close so they are live from bar 1,
//     and 15-bar momentum, the close less the close 15 bars back.
//   - Entry, on a bar's close: EMA(5) above EMA(13) and rising, the close
//     above EMA(13), and 15-bar momentum positive, on two consecutive bars.
//     Full size: all cash, capped by the weight cap. An entry the market
//     refuses is sent again while the signal holds; once any order has
//     filled, no second position is ever taken.
//   - Exit, the whole position: a hard stop at 3% under cost, or a trailing
//     stop 3% under the highest close since entry. An exit the market
//     refuses is sent again on the next bar while its reason still holds.
//   - Fallback: if no order has ever filled by batch 1200, one entry is
//     taken anyway on the next bar, under the same sizing and stops, so a
//     window that never confirmed a trend still leaves a trade on the
//     record instead of sitting out entirely.
//   - Each order caps slippage at 100 bps past the close it was decided on.
//
// All indicator math is float64 + - * / and comparisons alone, so the same
// bars give the same orders, run after run.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 5;
const SLOW_BARS = 13;
const MOM_BARS = 15;
/** Consecutive bars the entry signal must hold before buying. */
const CONFIRM_BARS = 2;
/** Hard stop: worth 97/100 of cost. */
const STOP = [97n, 100n] as const;
/** Trailing stop: 3% under the highest close since entry. */
const TRAIL = 0.03;
/** Fallback entry once no fill has landed by this batch. */
const FALLBACK_SEQ = 1200;
const MAX_SLIPPAGE_BPS = 100;

/** One EMA, seeded at the first close it sees. */
interface Ema {
  span: number;
  value: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  /** The fast EMA's value after the symbol's bar before this one. */
  prevFast: number | null;
  /** Its last MOM_BARS + 1 closes, oldest first. */
  closes: number[];
  /** Consecutive fresh bars the entry signal has held. */
  confirm: number;
  /** Highest close since the current position appeared, else null. */
  peak: number | null;
}

const series = new Map<string, Series>();
/** Whether any order of this run has filled yet: one filled position only. */
let everFilled = false;

function stepEma(e: Ema, close: number): void {
  if (e.value === null) {
    e.value = close;
    return;
  }
  e.value += (2 / (e.span + 1)) * (close - e.value);
}

/** Fold a bar into its symbol's indicators. */
function push(bar: Bar): Series {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = { fast: { span: FAST_BARS, value: null }, slow: { span: SLOW_BARS, value: null }, prevFast: null, closes: [], confirm: 0, peak: null };
    series.set(bar.symbol, s);
  }
  const c = Number(bar.c);
  s.prevFast = s.fast.value;
  stepEma(s.fast, c);
  stepEma(s.slow, c);
  s.closes.push(c);
  if (s.closes.length > MOM_BARS + 1) s.closes.shift();
  return s;
}

/** Whether the entry signal holds on this close: fast above slow and rising, momentum positive. */
function entrySignal(s: Series, close: number): boolean {
  if (s.fast.value === null || s.slow.value === null) return false;
  if (s.closes.length <= MOM_BARS) return false;
  if (s.fast.value <= s.slow.value) return false;
  if (s.prevFast !== null && s.fast.value < s.prevFast) return false;
  if (close <= s.slow.value) return false;
  return close - s.closes[0]! > 0;
}

/** Whether a held position exits on this close: hard stop or trailing stop. */
function exits(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }, s: Series, close: number): boolean {
  const value = state.value(symbol, held.qty);
  if (value * STOP[1] <= held.cost * STOP[0]) return true;
  return s.peak !== null && close < s.peak * (1 - TRAIL);
}

await runBars({
  onBatch(state, batch) {
    for (const fill of batch.fills) {
      if (fill.status === 'filled') everFilled = true;
    }
    const fresh = new Set<string>();
    for (const bar of batch.bars) {
      push(bar);
      fresh.add(bar.symbol);
    }
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const s = series.get(symbol)!;
      const close = Number(state.close(symbol)!);
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        if (s.peak === null || close > s.peak) s.peak = close;
        s.confirm = 0;
        if (exits(state, symbol, held, s, close)) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
        continue;
      }
      s.peak = null;
      if (everFilled) {
        s.confirm = 0;
        continue;
      }
      if (entrySignal(s, close)) {
        s.confirm += 1;
        if (s.confirm >= CONFIRM_BARS) entries.push(symbol);
      } else if (state.seq >= FALLBACK_SEQ) {
        entries.push(symbol);
      } else {
        s.confirm = 0;
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    // One entry at most: the first signaling symbol in universe order.
    const symbol = entries[0];
    if (symbol !== undefined && orders.length < caps.max_orders_per_bar) {
      const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
      let slice = state.cash < byWeight ? state.cash : byWeight;
      const weightRoom = state.weightRoom(symbol);
      if (weightRoom < slice) slice = weightRoom;
      if (slice !== 0n && slice >= BigInt(fees.min_notional_quote_units)) {
        orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }
    return orders;
  },
});
