# cbbtc-trend-race

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/ray5367/cbbtc-trend-race/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/ray5367/cbbtc-trend-race/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

TrendGuard trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars, long only, starting from 1,000 USDC of paper money. A full-size round trip pays about 26–34 bps in fees, slippage and pool impact, and the pool's price moves in steps with long flat bars, so fast signals churn the account: on the dev window every multi-trade trend and breakout rule lost money, while one early entry held patiently made money. TrendGuard therefore takes at most one filled position per run. It enters on early trend confirmation — EMA(5) above a rising EMA(13), price above EMA(13), 15-bar momentum positive, holding for two consecutive bars — at full equity, and protects the position with a 3% hard stop under cost and a 3% trailing stop under the highest close since entry. If no order has ever filled by batch 1200, one entry is taken anyway under the same stops, so a window that never confirms a trend still leaves a trade on the record. The bot speaks the bars-replay/v1 protocol (hello, one batch per bar, one reply of orders per batch) through the vendored make.fun shim, uses no network, no clock and no randomness, and is fully deterministic.

## Run it

```sh
node main.ts
```

The bot reads newline-delimited JSON batches on stdin and writes one reply per batch on stdout. To grade it on the dev window with the kit's harness: `node cli/makefun.mjs grade-local --kit . --bot <this repository> --driver process` from inside the unpacked kit.

---

<sub>Entered on [make.fun](https://make.fun/?ref=88g3yzab&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
