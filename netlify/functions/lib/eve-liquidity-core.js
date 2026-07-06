const { getSupabase } = require("./supabase");

const DEFAULT_MARKETS = [
  { symbol: "EUR/USD", display_name: "Euro / Dollar", asset_class: "forex", enabled: true, scan_priority: 1 },
  { symbol: "GBP/USD", display_name: "Pound / Dollar", asset_class: "forex", enabled: true, scan_priority: 2 },
  { symbol: "AUD/USD", display_name: "Aussie / Dollar", asset_class: "forex", enabled: true, scan_priority: 3 },
  { symbol: "USD/JPY", display_name: "Dollar / Yen", asset_class: "forex", enabled: true, scan_priority: 4 },
  { symbol: "USD/CAD", display_name: "Dollar / Cad", asset_class: "forex", enabled: true, scan_priority: 5 },
  { symbol: "EUR/JPY", display_name: "Euro / Yen", asset_class: "forex", enabled: true, scan_priority: 6 },
  { symbol: "GBP/JPY", display_name: "Pound / Yen", asset_class: "forex", enabled: true, scan_priority: 7 },
  { symbol: "XAU/USD", display_name: "Gold", asset_class: "metal", enabled: true, scan_priority: 8 },
  { symbol: "BTC/USD", display_name: "Bitcoin", asset_class: "crypto", enabled: true, scan_priority: 9 }
];

const ALLOWED_SCAN_SYMBOLS = new Set(DEFAULT_MARKETS.map((m) => m.symbol));

const INTERVALS = [
  { key: "h1", td: "1h", outputsize: 260 },
  { key: "m15", td: "15min", outputsize: 260 },
  { key: "m5", td: "5min", outputsize: 260 }
];

function clamp(n, min, max) { return Math.max(min, Math.min(max, Number.isFinite(Number(n)) ? Number(n) : 0)); }
function round(n, dp = 2) { const p = Math.pow(10, dp); return Math.round((Number(n) || 0) * p) / p; }
function mean(arr) { const clean = arr.filter(Number.isFinite); return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0; }
function median(arr) { const clean = arr.filter(Number.isFinite).sort((a, b) => a - b); if (!clean.length) return 0; const m = Math.floor(clean.length / 2); return clean.length % 2 ? clean[m] : (clean[m - 1] + clean[m]) / 2; }

function atr(candles, period = 14) {
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const high = candles[i].high, low = candles[i].low, prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return [];
  const out = [];
  let prev = mean(trs.slice(0, period));
  for (let i = 0; i < trs.length; i += 1) {
    if (i < period - 1) { out.push(null); continue; }
    if (i === period - 1) { out.push(prev); continue; }
    prev = (prev * (period - 1) + trs[i]) / period;
    out.push(prev);
  }
  return [null, ...out];
}

function parseTwelveDataValues(payload) {
  if (!payload) return [];
  if (payload.status === "error") throw new Error(payload.message || payload.code || "Twelve Data returned an error.");
  if (!Array.isArray(payload.values)) return [];
  return payload.values.map((v) => ({
    datetime: v.datetime,
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close),
    volume: v.volume === undefined ? null : Number(v.volume)
  })).filter((v) => v.datetime && [v.open, v.high, v.low, v.close].every(Number.isFinite)).reverse();
}

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(date);
  const obj = {};
  for (const p of parts) obj[p.type] = p.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: obj.weekday, dayOfWeek: weekdays[obj.weekday], year: Number(obj.year), month: Number(obj.month), day: Number(obj.day), hour: Number(obj.hour), minute: Number(obj.minute), second: Number(obj.second) };
}

function sessionScore(market, londonMinutes) {
  const hour = Math.floor(londonMinutes / 60);
  if (market.asset_class === "crypto") { if (hour >= 12 && hour <= 22) return 85; if (hour >= 7 && hour < 12) return 75; return 65; }
  if (market.asset_class === "metal") { if (hour >= 12 && hour <= 21) return 100; if (hour >= 7 && hour < 12) return 85; if (hour >= 22 || hour < 1) return 55; return 45; }
  if (market.asset_class === "forex") { if (hour >= 7 && hour < 12) return 95; if (hour >= 12 && hour <= 17) return 100; if (hour >= 18 && hour <= 21) return 65; if (hour >= 23 || hour < 6) return 45; return 60; }
  return 50;
}

function marketOpenInfo(market, now = new Date()) {
  const ny = dateParts(now, "America/New_York");
  const london = dateParts(now, "Europe/London");
  const minutesNY = ny.hour * 60 + ny.minute;
  const minutesLondon = london.hour * 60 + london.minute;
  if (market.asset_class === "crypto") return { is_open: true, mode: "crypto_24_7", reason: "Crypto open 24/7", session_score: sessionScore(market, minutesLondon) };
  if (market.asset_class === "forex") {
    const open = (ny.dayOfWeek === 0 && minutesNY >= 17 * 60 + 5) || (ny.dayOfWeek >= 1 && ny.dayOfWeek <= 4) || (ny.dayOfWeek === 5 && minutesNY <= 16 * 60 + 55);
    return { is_open: open, mode: open ? "weekday" : "closed", reason: open ? "Forex market open" : "Forex market closed", session_score: open ? sessionScore(market, minutesLondon) : 0 };
  }
  if (market.asset_class === "metal") {
    const broadlyOpen = (ny.dayOfWeek === 0 && minutesNY >= 18 * 60 + 5) || (ny.dayOfWeek >= 1 && ny.dayOfWeek <= 4) || (ny.dayOfWeek === 5 && minutesNY <= 16 * 60 + 55);
    const dailyBreak = ny.dayOfWeek >= 1 && ny.dayOfWeek <= 5 && minutesNY >= 16 * 60 + 55 && minutesNY < 18 * 60 + 5;
    const open = broadlyOpen && !dailyBreak;
    return { is_open: open, mode: open ? "weekday" : "closed", reason: open ? "Metal market open" : "Metal market closed / daily break", session_score: open ? sessionScore(market, minutesLondon) : 0 };
  }
  return { is_open: false, mode: "closed", reason: "Unknown market type", session_score: 0 };
}

function parseCandleDate(candleDatetime) {
  const s = String(candleDatetime || "").replace(" ", "T");
  const d = new Date(s.endsWith("Z") ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function timeframeMs(intervalKey) { return intervalKey === "m5" ? 5 * 60 * 1000 : intervalKey === "m15" ? 15 * 60 * 1000 : 60 * 60 * 1000; }
function isFresh(candleDatetime, intervalKey, now = new Date()) { const d = parseCandleDate(candleDatetime); if (!d) return false; const maxAge = intervalKey === "m5" ? 20 * 60 * 1000 : timeframeMs(intervalKey) * 3; return now.getTime() - d.getTime() <= maxAge; }

function pricePrecision(symbol) {
  if (symbol.includes("JPY")) return 3;
  if (["EUR/USD", "GBP/USD", "AUD/USD", "USD/CAD"].includes(symbol)) return 5;
  if (symbol.includes("BTC")) return 0;
  if (symbol.includes("ETH")) return 1;
  if (symbol.includes("SOL")) return 2;
  if (symbol.includes("XAG")) return 3;
  return 2;
}

function pipSize(symbol) {
  if (symbol.includes("JPY")) return 0.01;
  if (["EUR/USD", "GBP/USD", "AUD/USD", "USD/CAD"].includes(symbol)) return 0.0001;
  return null;
}

function minMeaningfulDistance(symbol, latestPrice, m5Atr) {
  const atrPart = (Number(m5Atr) || 0) * 0.45;
  if (symbol.includes("XAU")) return Math.max(atrPart, 1.2);
  if (symbol.includes("XAG")) return Math.max(atrPart, 0.035);
  if (symbol.includes("BTC")) return Math.max(atrPart, Number(latestPrice || 0) * 0.0015);
  if (symbol.includes("ETH")) return Math.max(atrPart, Number(latestPrice || 0) * 0.0018);
  if (symbol.includes("SOL")) return Math.max(atrPart, Number(latestPrice || 0) * 0.0025);
  const pip = pipSize(symbol);
  if (pip) return Math.max(atrPart, (symbol.includes("JPY") ? 7 : 5) * pip);
  return Math.max(atrPart, Number(latestPrice || 0) * 0.001);
}

function recentAtr(candles) {
  const values = atr(candles || [], 14).slice(-40).filter(Number.isFinite);
  return median(values) || 0;
}

function timeframeWeight(tf) {
  if (tf === "h1") return 84;
  if (tf === "m15") return 88;
  if (tf === "m5") return 66;
  return 60;
}

function sourceBaseScore(kind) {
  if (kind === "equal_highs" || kind === "equal_lows") return 96;
  if (kind === "cluster_high" || kind === "cluster_low") return 88;
  if (kind === "session_high" || kind === "session_low") return 86;
  if (kind === "previous_h1_high" || kind === "previous_h1_low") return 82;
  if (kind === "previous_m15_high" || kind === "previous_m15_low") return 78;
  return 68;
}

function detectSwings(candles, tf, symbol, depth = 2) {
  const out = [];
  if (!Array.isArray(candles) || candles.length < depth * 2 + 20) return out;
  const start = Math.max(depth, candles.length - 180);
  for (let i = start; i < candles.length - depth; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - depth; j <= i + depth; j += 1) {
      if (j === i) continue;
      if (candles[i].high <= candles[j].high) isHigh = false;
      if (candles[i].low >= candles[j].low) isLow = false;
    }
    if (isHigh) out.push({ side: "above", price: candles[i].high, tf, kind: `${tf}_swing_high`, type: `${tf.toUpperCase()} swing high`, time: candles[i].datetime, cluster_count: 1, symbol });
    if (isLow) out.push({ side: "below", price: candles[i].low, tf, kind: `${tf}_swing_low`, type: `${tf.toUpperCase()} swing low`, time: candles[i].datetime, cluster_count: 1, symbol });
  }
  return out;
}

function clusterLevels(levels, side, tf, tolerance) {
  const relevant = levels.filter((l) => l.side === side && l.tf === tf).sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const lvl of relevant) {
    let placed = false;
    for (const c of clusters) {
      const anchor = c.levels.reduce((sum, x) => sum + x.price, 0) / c.levels.length;
      if (Math.abs(lvl.price - anchor) <= tolerance) { c.levels.push(lvl); placed = true; break; }
    }
    if (!placed) clusters.push({ levels: [lvl] });
  }
  return clusters.filter((c) => c.levels.length >= 2).map((c) => {
    const prices = c.levels.map((l) => l.price);
    const price = side === "above" ? Math.max(...prices) : Math.min(...prices);
    const count = c.levels.length;
    return {
      side,
      price,
      tf,
      kind: side === "above" ? (count >= 3 ? "cluster_high" : "equal_highs") : (count >= 3 ? "cluster_low" : "equal_lows"),
      type: side === "above" ? (count >= 3 ? `${tf.toUpperCase()} clustered highs` : `${tf.toUpperCase()} equal highs`) : (count >= 3 ? `${tf.toUpperCase()} clustered lows` : `${tf.toUpperCase()} equal lows`),
      time: c.levels[c.levels.length - 1].time,
      cluster_count: count,
      symbol: c.levels[0].symbol
    };
  });
}

function londonMinutesForCandle(c) {
  const d = parseCandleDate(c.datetime);
  if (!d) return null;
  const p = dateParts(d, "Europe/London");
  return { dayKey: `${p.year}-${p.month}-${p.day}`, minutes: p.hour * 60 + p.minute };
}

function sessionLevelsFromM5(candles, symbol) {
  if (!Array.isArray(candles) || candles.length < 20) return [];
  const lastParts = londonMinutesForCandle(candles[candles.length - 1]);
  if (!lastParts) return [];
  const today = candles.filter((c) => londonMinutesForCandle(c)?.dayKey === lastParts.dayKey);
  if (today.length < 8) return [];
  const currentMin = lastParts.minutes;
  let start = 0;
  let name = "Asia";
  if (currentMin >= 7 * 60 && currentMin < 12 * 60) { start = 7 * 60; name = "London"; }
  else if (currentMin >= 12 * 60 && currentMin < 21 * 60) { start = 12 * 60; name = "New York"; }
  else if (currentMin >= 21 * 60) { start = 21 * 60; name = "Late"; }
  const session = today.filter((c) => { const p = londonMinutesForCandle(c); return p && p.minutes >= start && p.minutes <= currentMin; });
  if (session.length < 6) return [];
  const highC = session.reduce((a, b) => b.high > a.high ? b : a, session[0]);
  const lowC = session.reduce((a, b) => b.low < a.low ? b : a, session[0]);
  return [
    { side: "above", price: highC.high, tf: "m5", kind: "session_high", type: `${name} session high`, time: highC.datetime, cluster_count: 1, symbol },
    { side: "below", price: lowC.low, tf: "m5", kind: "session_low", type: `${name} session low`, time: lowC.datetime, cluster_count: 1, symbol }
  ];
}

function generateLiquidityLevels(symbol, candlesByTf) {
  const all = [];
  const m5Atr = recentAtr(candlesByTf.m5 || []);
  const m15Atr = recentAtr(candlesByTf.m15 || []);
  const h1Atr = recentAtr(candlesByTf.h1 || []);
  for (const tf of ["h1", "m15", "m5"]) {
    const candles = candlesByTf[tf] || [];
    const depth = tf === "m5" ? 2 : 2;
    const swings = detectSwings(candles, tf, symbol, depth);
    const tfAtr = tf === "h1" ? h1Atr : tf === "m15" ? m15Atr : m5Atr;
    const tolerance = Math.max((tfAtr || 0) * 0.18, Math.abs((candles[candles.length - 1]?.close || 1) * 0.00005));
    all.push(...swings);
    all.push(...clusterLevels(swings, "above", tf, tolerance));
    all.push(...clusterLevels(swings, "below", tf, tolerance));
    if (candles.length >= 3 && (tf === "h1" || tf === "m15")) {
      const prev = candles[candles.length - 2];
      all.push({ side: "above", price: prev.high, tf, kind: tf === "h1" ? "previous_h1_high" : "previous_m15_high", type: `Previous ${tf.toUpperCase()} high`, time: prev.datetime, cluster_count: 1, symbol });
      all.push({ side: "below", price: prev.low, tf, kind: tf === "h1" ? "previous_h1_low" : "previous_m15_low", type: `Previous ${tf.toUpperCase()} low`, time: prev.datetime, cluster_count: 1, symbol });
    }
  }
  all.push(...sessionLevelsFromM5(candlesByTf.m5 || [], symbol));
  // De-duplicate near-identical levels, keeping stronger source.
  const sorted = all.filter((l) => Number.isFinite(Number(l.price))).sort((a, b) => sourceBaseScore(b.kind) - sourceBaseScore(a.kind));
  const deduped = [];
  const tolerance = Math.max((m5Atr || 0) * 0.08, Math.abs(((candlesByTf.m5 || []).at(-1)?.close || 1) * 0.00002));
  for (const l of sorted) {
    if (!deduped.some((x) => x.side === l.side && Math.abs(x.price - l.price) <= tolerance)) deduped.push(l);
  }
  return { levels: deduped, m5Atr };
}

function scoreCandidate(level, { symbol, anchor, latestPrice, m5Atr }) {
  const distance = Math.abs(Number(level.price) - Number(anchor));
  const minDist = minMeaningfulDistance(symbol, latestPrice, m5Atr);
  // Tiny local levels are ignored unless they are clean equal highs/lows or session levels.
  const exceptional = ["equal_highs", "equal_lows", "cluster_high", "cluster_low", "session_high", "session_low"].includes(level.kind);
  if (distance < minDist && !exceptional) return null;
  if (distance < minDist * 0.55) return null;
  const atrDist = (Number(m5Atr) || 0) > 0 ? distance / m5Atr : 3;
  const ideal = 2.8;
  const distanceScore = clamp(100 - Math.abs(atrDist - ideal) * 13, 35, 100);
  const base = sourceBaseScore(level.kind);
  const tfScore = timeframeWeight(level.tf);
  const clusterBonus = Math.min(12, Math.max(0, (Number(level.cluster_count || 1) - 1) * 5));
  let quality = base * 0.42 + distanceScore * 0.25 + tfScore * 0.23 + clusterBonus;
  if (level.tf === "m5" && !exceptional) quality -= 8;
  if (distance < minDist) quality -= 10;
  quality = clamp(quality, 0, 100);
  if (quality < 60) return null;
  return {
    price: round(level.price, pricePrecision(symbol)),
    type: level.type,
    timeframe: level.tf,
    quality: round(quality, 2),
    distance: round(distance, pricePrecision(symbol)),
    distance_atr: round(atrDist, 2),
    status: "Untaken",
    time: level.time,
    reason: `${level.type} ${level.side === "above" ? "above" : "below"}; ${round(atrDist, 2)} M5 ATR from reference.`,
    raw: { kind: level.kind, cluster_count: level.cluster_count || 1, anchor, minDist: round(minDist, pricePrecision(symbol)) }
  };
}

function pickLevel(levels, side, anchor, context) {
  const filtered = levels.filter((l) => {
    if (side === "above") return Number(l.price) > Number(anchor);
    return Number(l.price) < Number(anchor);
  });
  const scored = filtered.map((l) => scoreCandidate(l, { ...context, anchor })).filter(Boolean);
  scored.sort((a, b) => b.quality - a.quality || Math.abs(a.price - anchor) - Math.abs(b.price - anchor));
  return scored[0] || null;
}

function normalizeZoneRow(zoneRow) {
  if (!zoneRow) return null;
  return {
    demand: zoneRow.demand_low && zoneRow.demand_high ? {
      low: Number(zoneRow.demand_low), high: Number(zoneRow.demand_high), quality: Number(zoneRow.demand_quality || 0), status: zoneRow.demand_status, timeframe: zoneRow.demand_timeframe
    } : null,
    supply: zoneRow.supply_low && zoneRow.supply_high ? {
      low: Number(zoneRow.supply_low), high: Number(zoneRow.supply_high), quality: Number(zoneRow.supply_quality || 0), status: zoneRow.supply_status, timeframe: zoneRow.supply_timeframe
    } : null,
    source_created_at: zoneRow.created_at,
    source_scan_id: zoneRow.scan_id
  };
}

function calculateZoneAwareLiquidity(market, candlesByTf, zoneRow, openInfo, now = new Date()) {
  if (!openInfo.is_open) return resultForClosedMarket(market, openInfo);
  const latestM5 = candlesByTf.m5?.[candlesByTf.m5.length - 1];
  const fresh = latestM5 && isFresh(latestM5.datetime, "m5", now);
  if (!fresh) {
    return {
      symbol: market.symbol, display_name: market.display_name, asset_class: market.asset_class,
      is_open: false, is_stale: true, latest_price: latestM5?.close || null, latest_candle_at: latestM5?.datetime || null,
      status: "Stale / excluded", reason: "Latest M5 candle is stale, so EVE Liquidity excluded this market.", best_quality: 0, raw: { openInfo }
    };
  }

  const zones = normalizeZoneRow(zoneRow);
  const latestPrice = latestM5.close;
  const { levels, m5Atr } = generateLiquidityLevels(market.symbol, candlesByTf);
  const context = { symbol: market.symbol, latestPrice, m5Atr };
  const demand = zones?.demand || null;
  const supply = zones?.supply || null;

  const demand_sweep = demand ? pickLevel(levels, "below", demand.low, context) : null;
  const demand_target = demand ? pickLevel(levels, "above", Math.max(demand.high, latestPrice), context) : null;
  const supply_sweep = supply ? pickLevel(levels, "above", supply.high, context) : null;
  const supply_target = supply ? pickLevel(levels, "below", Math.min(supply.low, latestPrice), context) : null;

  const qualities = [demand_sweep, demand_target, supply_sweep, supply_target].map((x) => Number(x?.quality || 0)).filter((x) => x > 0);
  const bestQuality = qualities.length ? Math.max(...qualities) : 0;
  const availableCount = qualities.length;
  let status = "No meaningful liquidity";
  if (!demand && !supply) status = "Waiting for EVE Zones";
  else if (bestQuality >= 85) status = "Excellent liquidity map";
  else if (bestQuality >= 75) status = "Strong liquidity map";
  else if (bestQuality >= 65) status = "Useful liquidity";
  else if (availableCount) status = "Light liquidity only";

  const reasonBits = [];
  if (!demand) reasonBits.push("No valid demand zone from EVE Zones");
  else {
    reasonBits.push(`Demand ${round(demand.low, pricePrecision(market.symbol))}–${round(demand.high, pricePrecision(market.symbol))}`);
    reasonBits.push(demand_sweep ? `sweep below ${demand_sweep.price}` : "no meaningful sweep below demand");
    reasonBits.push(demand_target ? `target above ${demand_target.price}` : "no meaningful target above demand");
  }
  if (!supply) reasonBits.push("No valid supply zone from EVE Zones");
  else {
    reasonBits.push(`Supply ${round(supply.low, pricePrecision(market.symbol))}–${round(supply.high, pricePrecision(market.symbol))}`);
    reasonBits.push(supply_sweep ? `sweep above ${supply_sweep.price}` : "no meaningful sweep above supply");
    reasonBits.push(supply_target ? `target below ${supply_target.price}` : "no meaningful target below supply");
  }

  return {
    symbol: market.symbol,
    display_name: market.display_name,
    asset_class: market.asset_class,
    is_open: true,
    is_stale: false,
    latest_price: latestPrice,
    latest_candle_at: latestM5.datetime,
    demand_zone: demand,
    supply_zone: supply,
    demand_sweep,
    demand_target,
    supply_sweep,
    supply_target,
    best_quality: round(bestQuality, 2),
    status,
    reason: reasonBits.join(". "),
    raw: { openInfo, levels_found: levels.length, m5Atr: round(m5Atr, pricePrecision(market.symbol)), zone_source: zones ? { created_at: zones.source_created_at, scan_id: zones.source_scan_id } : null }
  };
}

function resultForClosedMarket(market, openInfo) {
  return {
    symbol: market.symbol, display_name: market.display_name, asset_class: market.asset_class,
    is_open: false, is_stale: false, latest_price: null, latest_candle_at: null,
    demand_zone: null, supply_zone: null, demand_sweep: null, demand_target: null, supply_sweep: null, supply_target: null,
    best_quality: 0, status: "Closed", reason: openInfo.reason, raw: { openInfo }
  };
}

async function fetchCandles(symbol, interval, outputsize) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) throw new Error("TWELVEDATA_API_KEY is not set in Netlify environment variables.");
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("format", "JSON");
  url.searchParams.set("timezone", "UTC");
  const exchange = process.env.TWELVEDATA_EXCHANGE;
  if (exchange) url.searchParams.set("exchange", exchange);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status} for ${symbol} ${interval}`);
  return parseTwelveDataValues(await res.json());
}

async function loadSettings(sb) {
  const { data, error } = await sb.from("eve_liquidity_settings").select("key,value,updated_at");
  if (error) throw error;
  const settings = {};
  for (const row of data || []) settings[row.key] = row.value;
  if (settings.liquidity_scanner_enabled === undefined) settings.liquidity_scanner_enabled = true;
  return settings;
}

async function setScannerEnabled(enabled, changedBy = "admin") {
  const sb = getSupabase();
  const { error } = await sb.from("eve_liquidity_settings").upsert({ key: "liquidity_scanner_enabled", value: Boolean(enabled), updated_at: new Date().toISOString(), changed_by: changedBy });
  if (error) throw error;
  return Boolean(enabled);
}

async function loadMarkets(sb) {
  const { data, error } = await sb.from("eve_liquidity_markets").select("symbol,display_name,asset_class,enabled,scan_priority").eq("enabled", true).order("scan_priority", { ascending: true });
  if (error) throw error;
  if (!data || !data.length) return DEFAULT_MARKETS;

  // Safety filter: even if old rows remain enabled in Supabase,
  // this scanner only burns Twelve Data calls on the approved reduced list.
  const filtered = data.filter((m) => ALLOWED_SCAN_SYMBOLS.has(m.symbol));
  return filtered.length ? filtered : DEFAULT_MARKETS;
}

async function loadLatestZonesMap(sb) {
  // EVE Liquidity is zone-aware. It uses the latest EVE Zones results if present.
  const { data: latestRun, error: runError } = await sb.from("eve_zones_scan_runs").select("id,completed_at,started_at").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (runError) {
    // If EVE Zones tables are not installed yet, return empty instead of killing the Liquidity scanner.
    if (String(runError.message || "").toLowerCase().includes("eve_zones")) return new Map();
    throw runError;
  }
  if (!latestRun?.id) return new Map();
  const { data, error } = await sb.from("eve_zones_market_zones").select("scan_id,symbol,demand_low,demand_high,demand_quality,demand_status,demand_timeframe,supply_low,supply_high,supply_quality,supply_status,supply_timeframe,created_at").eq("scan_id", latestRun.id);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.symbol, r]));
}

function isManualUnsafeMoment(now = new Date()) {
  const mod = now.getUTCMinutes() % 5;
  // Bias 00, Structure 01, Zones 02. Liquidity owns 03.
  return mod === 0 || mod === 1 || mod === 2;
}


const SCHEDULED_SCAN_LOCK_MINUTES = Number(process.env.SCHEDULED_SCAN_LOCK_MINUTES || 4);

async function skipIfRecentScheduledRun(sb, tableName, currentRunId, startedAt, source, force) {
  if (source !== "scheduled" || force) return null;

  const lockMinutes = Number.isFinite(SCHEDULED_SCAN_LOCK_MINUTES) && SCHEDULED_SCAN_LOCK_MINUTES > 0
    ? SCHEDULED_SCAN_LOCK_MINUTES
    : 4;
  const cutoffIso = new Date(startedAt.getTime() - lockMinutes * 60 * 1000).toISOString();
  const startedIso = startedAt.toISOString();

  const { data: recentRun, error } = await sb
    .from(tableName)
    .select("id,started_at,completed_at,mode,source")
    .neq("id", currentRunId)
    .eq("source", "scheduled")
    .neq("mode", "skipped_recent_run")
    .gte("started_at", cutoffIso)
    .lt("started_at", startedIso)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!recentRun) return null;

  const completedAt = new Date();
  const notes = `Scheduled scan skipped: another scheduled run already started at ${recentRun.started_at} within the last ${lockMinutes} minutes. No Twelve Data calls made.`;

  const { error: updateError } = await sb.from(tableName).update({
    completed_at: completedAt.toISOString(),
    mode: "skipped_recent_run",
    markets_requested: 0,
    markets_scanned: 0,
    markets_open: 0,
    errors: [],
    notes
  }).eq("id", currentRunId);
  if (updateError) throw updateError;

  return {
    ok: true,
    skipped: true,
    scan_id: currentRunId,
    mode: "skipped_recent_run",
    reason: "recent_scheduled_run",
    recent_scan_id: recentRun.id,
    recent_started_at: recentRun.started_at,
    lock_minutes: lockMinutes,
    message: notes,
    started_at: startedIso,
    completed_at: completedAt.toISOString()
  };
}

async function runScan({ source = "scheduled", force = false } = {}) {
  const startedAt = new Date();
  if (source === "manual" && !force && isManualUnsafeMoment(startedAt)) {
    return { ok: true, delayed: true, mode: "api_safety_delay", message: "API safety lock: wait until the Liquidity stagger window. Other EVE scanners may be using this minute." };
  }

  const sb = getSupabase();
  const settings = await loadSettings(sb);
  const scannerEnabled = settings.liquidity_scanner_enabled !== false;

  const runInsert = await sb.from("eve_liquidity_scan_runs").insert({
    started_at: startedAt.toISOString(),
    mode: scannerEnabled ? "starting" : "liquidity_scanner_off",
    scanner_enabled: scannerEnabled,
    source,
    markets_requested: 0,
    markets_scanned: 0,
    markets_open: 0,
    errors: []
  }).select("id").single();
  if (runInsert.error) throw runInsert.error;
  const runId = runInsert.data.id;

  const recentRunSkip = await skipIfRecentScheduledRun(sb, "eve_liquidity_scan_runs", runId, startedAt, source, force);
  if (recentRunSkip) return recentRunSkip;

  if (!scannerEnabled && !force) {
    await sb.from("eve_liquidity_scan_runs").update({ completed_at: new Date().toISOString(), mode: "liquidity_scanner_off", notes: "Liquidity scanner is OFF. No Twelve Data calls made." }).eq("id", runId);
    return { ok: true, scan_id: runId, mode: "liquidity_scanner_off", scanner_enabled: false, markets: [], message: "Liquidity scanner is OFF. No Twelve Data calls made." };
  }

  const markets = await loadMarkets(sb);
  const zoneMap = await loadLatestZonesMap(sb);
  const now = new Date();
  const openInfos = markets.map((m) => ({ market: m, openInfo: marketOpenInfo(m, now) }));
  const openMarkets = openInfos.filter((x) => x.openInfo.is_open);
  const cryptoOnly = openMarkets.length > 0 && openMarkets.every((x) => x.market.asset_class === "crypto");
  const mode = cryptoOnly ? "weekend_crypto_only" : "weekday";
  const results = [];
  const errors = [];

  for (const { market, openInfo } of openInfos) {
    try {
      if (!openInfo.is_open) { results.push(resultForClosedMarket(market, openInfo)); continue; }
      const candlesByTf = {};
      for (const tf of INTERVALS) candlesByTf[tf.key] = await fetchCandles(market.symbol, tf.td, tf.outputsize);
      results.push(calculateZoneAwareLiquidity(market, candlesByTf, zoneMap.get(market.symbol), openInfo, now));
    } catch (err) {
      errors.push({ symbol: market.symbol, message: err.message || String(err) });
      results.push({
        symbol: market.symbol, display_name: market.display_name, asset_class: market.asset_class,
        is_open: false, is_stale: true, latest_price: null, latest_candle_at: null,
        demand_zone: null, supply_zone: null, demand_sweep: null, demand_target: null, supply_sweep: null, supply_target: null,
        best_quality: 0, status: "Error / excluded", reason: err.message || "Data error", raw: { error: err.message || String(err), openInfo }
      });
    }
  }

  const rankable = results.filter((r) => r.is_open && !r.is_stale && r.best_quality > 0);
  rankable.sort((a, b) => b.best_quality - a.best_quality);
  rankable.forEach((r, i) => { r.rank = i + 1; });
  const top = rankable[0] || null;
  const topLiquidity = top ? topLiquidityFromResult(top) : null;

  const rows = results.map((r) => rowFromResult(r, runId));
  if (rows.length) {
    const { error: insertError } = await sb.from("eve_liquidity_market_results").insert(rows);
    if (insertError) throw insertError;
    await checkPriceAlarms(sb, rows);
  }

  const completedAt = new Date();
  const { error: updateRunError } = await sb.from("eve_liquidity_scan_runs").update({
    completed_at: completedAt.toISOString(), mode, scanner_enabled: scannerEnabled,
    markets_requested: markets.length, markets_scanned: openMarkets.length, markets_open: rankable.length,
    top_symbol: top?.symbol || null, top_level_key: topLiquidity?.level_key || null, errors,
    notes: errors.length ? "Liquidity scan completed with one or more market errors." : "Liquidity scan completed."
  }).eq("id", runId);
  if (updateRunError) throw updateRunError;

  return { ok: true, scan_id: runId, mode, scanner_enabled: scannerEnabled, markets_requested: markets.length, markets_scanned: openMarkets.length, markets_open: rankable.length, top_symbol: top?.symbol || null, errors, started_at: startedAt.toISOString(), completed_at: completedAt.toISOString() };
}

function topLiquidityFromResult(r) {
  const items = [
    ["demand_sweep", r.demand_sweep],
    ["demand_target", r.demand_target],
    ["supply_sweep", r.supply_sweep],
    ["supply_target", r.supply_target]
  ].filter(([, x]) => x);
  if (!items.length) return null;
  items.sort((a, b) => b[1].quality - a[1].quality);
  const [key, item] = items[0];
  return { symbol: r.symbol, level_key: key, price: item.price, quality: item.quality, type: item.type, reason: item.reason };
}

function rowFromResult(r, runId) {
  return {
    scan_id: runId,
    symbol: r.symbol,
    display_name: r.display_name,
    asset_class: r.asset_class,
    is_open: r.is_open,
    is_stale: Boolean(r.is_stale),
    rank: r.rank || null,
    latest_price: r.latest_price || null,
    latest_candle_at: r.latest_candle_at || null,
    demand_low: r.demand_zone?.low || null,
    demand_high: r.demand_zone?.high || null,
    demand_quality: r.demand_zone?.quality || null,
    demand_status: r.demand_zone?.status || null,
    supply_low: r.supply_zone?.low || null,
    supply_high: r.supply_zone?.high || null,
    supply_quality: r.supply_zone?.quality || null,
    supply_status: r.supply_zone?.status || null,
    demand_sweep_price: r.demand_sweep?.price || null,
    demand_sweep_type: r.demand_sweep?.type || null,
    demand_sweep_quality: r.demand_sweep?.quality || null,
    demand_sweep_reason: r.demand_sweep?.reason || null,
    demand_target_price: r.demand_target?.price || null,
    demand_target_type: r.demand_target?.type || null,
    demand_target_quality: r.demand_target?.quality || null,
    demand_target_reason: r.demand_target?.reason || null,
    supply_sweep_price: r.supply_sweep?.price || null,
    supply_sweep_type: r.supply_sweep?.type || null,
    supply_sweep_quality: r.supply_sweep?.quality || null,
    supply_sweep_reason: r.supply_sweep?.reason || null,
    supply_target_price: r.supply_target?.price || null,
    supply_target_type: r.supply_target?.type || null,
    supply_target_quality: r.supply_target?.quality || null,
    supply_target_reason: r.supply_target?.reason || null,
    best_quality: r.best_quality || 0,
    status: r.status,
    reason: r.reason,
    raw: r.raw || {}
  };
}

function nextStaggeredScanIso(from = new Date()) {
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  const m = d.getUTCMinutes();
  for (let i = 0; i <= 60; i += 1) {
    const test = (m + i) % 60;
    if ([3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 58].includes(test)) {
      d.setUTCMinutes(m + i);
      if (d.getTime() <= from.getTime()) d.setUTCMinutes(d.getUTCMinutes() + 5);
      return d.toISOString();
    }
  }
  d.setUTCMinutes(m + 5);
  return d.toISOString();
}

async function getLatestResults() {
  const sb = getSupabase();
  const settings = await loadSettings(sb);
  // Show the latest real scan on the dashboard. Duplicate scheduled runs are recorded
  // in eve_liquidity_scan_runs as skipped_recent_run, but they must not wipe the visible result.
  const { data: run, error: runError } = await sb
    .from("eve_liquidity_scan_runs")
    .select("id,started_at,completed_at,mode,scanner_enabled,markets_requested,markets_scanned,markets_open,top_symbol,top_level_key,source,notes,errors")
    .neq("mode", "skipped_recent_run")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;
  let rows = [];
  if (run?.id) {
    const { data, error } = await sb.from("eve_liquidity_market_results").select("*").eq("scan_id", run.id).order("rank", { ascending: true, nullsFirst: false }).order("best_quality", { ascending: false });
    if (error) throw error;
    rows = data || [];
  }
  const topRow = rows.find((r) => r.rank === 1) || null;
  const top_liquidity = topLiquidityFromRow(topRow);
  const leaders = buildLeaders(rows);
  const alarms = await loadPriceAlarms(sb);
  const now = new Date();
  const markets = await loadMarkets(sb);
  const liveOpenStatus = markets.map((market) => ({ symbol: market.symbol, is_open_now: marketOpenInfo(market, now).is_open, asset_class: market.asset_class }));
  return { ok: true, generated_at: now.toISOString(), next_scan_at: nextStaggeredScanIso(now), scanner_enabled: settings.liquidity_scanner_enabled !== false, latest_run: run || null, markets: rows, top_liquidity, leaders, price_alarms: alarms, live_open_status: liveOpenStatus };
}

function topLiquidityFromRow(r) {
  if (!r) return null;
  const choices = [
    { level_key: "demand_sweep", price: r.demand_sweep_price, type: r.demand_sweep_type, quality: Number(r.demand_sweep_quality || 0), reason: r.demand_sweep_reason },
    { level_key: "demand_target", price: r.demand_target_price, type: r.demand_target_type, quality: Number(r.demand_target_quality || 0), reason: r.demand_target_reason },
    { level_key: "supply_sweep", price: r.supply_sweep_price, type: r.supply_sweep_type, quality: Number(r.supply_sweep_quality || 0), reason: r.supply_sweep_reason },
    { level_key: "supply_target", price: r.supply_target_price, type: r.supply_target_type, quality: Number(r.supply_target_quality || 0), reason: r.supply_target_reason }
  ].filter((x) => x.price && x.quality > 0).sort((a, b) => b.quality - a.quality);
  const c = choices[0];
  return c ? { symbol: r.symbol, ...c } : null;
}

function buildLeaders(rows) {
  const open = (rows || []).filter((r) => r.is_open && !r.is_stale);
  const topDemandSweep = open.filter((r) => Number(r.demand_sweep_quality || 0) > 0).sort((a, b) => Number(b.demand_sweep_quality) - Number(a.demand_sweep_quality))[0] || null;
  const topDemandTarget = open.filter((r) => Number(r.demand_target_quality || 0) > 0).sort((a, b) => Number(b.demand_target_quality) - Number(a.demand_target_quality))[0] || null;
  const topSupplySweep = open.filter((r) => Number(r.supply_sweep_quality || 0) > 0).sort((a, b) => Number(b.supply_sweep_quality) - Number(a.supply_sweep_quality))[0] || null;
  const topSupplyTarget = open.filter((r) => Number(r.supply_target_quality || 0) > 0).sort((a, b) => Number(b.supply_target_quality) - Number(a.supply_target_quality))[0] || null;
  return { topDemandSweep, topDemandTarget, topSupplySweep, topSupplyTarget };
}

async function getLatestPriceForSymbol(sb, symbol) {
  const { data, error } = await sb.from("eve_liquidity_market_results").select("latest_price,created_at").eq("symbol", symbol).not("latest_price", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return Number(data?.latest_price) || null;
}

async function getLatestLiquidityLevelForSymbol(sb, symbol, levelKey) {
  const { data, error } = await sb.from("eve_liquidity_market_results").select("*").eq("symbol", symbol).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const map = {
    demand_sweep: { price: data.demand_sweep_price, label: "Demand sweep" },
    demand_target: { price: data.demand_target_price, label: "Demand target" },
    supply_sweep: { price: data.supply_sweep_price, label: "Supply sweep" },
    supply_target: { price: data.supply_target_price, label: "Supply target" }
  };
  const item = map[levelKey];
  if (!item || !item.price) return null;
  return { symbol, level_key: levelKey, target_price: Number(item.price), latest_price: Number(data.latest_price) || null, label: item.label };
}

async function loadPriceAlarms(sb = getSupabase()) {
  const { data, error } = await sb.from("eve_liquidity_price_alarms").select("id,symbol,target_price,trigger_direction,is_active,is_triggered,triggered_at,acknowledged_at,last_checked_price,last_checked_at,created_at,updated_at,label,level_key").order("is_triggered", { ascending: false }).order("created_at", { ascending: false });
  if (error) { if (String(error.message || "").toLowerCase().includes("eve_liquidity_price_alarms")) return []; throw error; }
  return data || [];
}

async function createPriceAlarm({ symbol, target_price, trigger_direction = "auto", label = null, level_key = null }) {
  const sb = getSupabase();
  const target = Number(target_price);
  if (!symbol) throw new Error("Market symbol is required.");
  if (!Number.isFinite(target) || target <= 0) throw new Error("Valid target price is required.");
  const markets = await loadMarkets(sb);
  if (!markets.find((m) => m.symbol === symbol)) throw new Error(`Unknown or disabled market: ${symbol}`);
  const latestPrice = await getLatestPriceForSymbol(sb, symbol);
  let direction = String(trigger_direction || "auto").toLowerCase();
  if (direction === "auto") direction = latestPrice !== null && target < latestPrice ? "below" : "above";
  if (!["above", "below"].includes(direction)) throw new Error("Alarm direction must be above, below or auto.");
  const { data, error } = await sb.from("eve_liquidity_price_alarms").insert({ symbol, target_price: target, trigger_direction: direction, is_active: true, is_triggered: false, last_checked_price: latestPrice, last_checked_at: latestPrice === null ? null : new Date().toISOString(), label, level_key }).select("id,symbol,target_price,trigger_direction,is_active,is_triggered,last_checked_price,created_at,label,level_key").single();
  if (error) throw error;
  return data;
}

async function createLiquidityAlarm({ symbol, level_key }) {
  const sb = getSupabase();
  const key = String(level_key || "").toLowerCase();
  if (!["demand_sweep", "demand_target", "supply_sweep", "supply_target"].includes(key)) throw new Error("level_key must be one of demand_sweep, demand_target, supply_sweep, supply_target.");
  const lvl = await getLatestLiquidityLevelForSymbol(sb, symbol, key);
  if (!lvl) throw new Error(`No ${key.replaceAll("_", " ")} level found for ${symbol}.`);
  const direction = lvl.target_price < (lvl.latest_price || lvl.target_price) ? "below" : "above";
  return createPriceAlarm({ symbol, target_price: lvl.target_price, trigger_direction: direction, label: lvl.label, level_key: key });
}

async function deletePriceAlarm(id) { const sb = getSupabase(); if (!id) throw new Error("Alarm id is required."); const { error } = await sb.from("eve_liquidity_price_alarms").delete().eq("id", id); if (error) throw error; return true; }
async function acknowledgePriceAlarm(id) { const sb = getSupabase(); if (!id) throw new Error("Alarm id is required."); const { data, error } = await sb.from("eve_liquidity_price_alarms").update({ is_active: false, acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).select("id,symbol,target_price,trigger_direction,is_triggered,acknowledged_at").single(); if (error) throw error; return data; }
async function acknowledgeAllTriggeredAlarms() { const sb = getSupabase(); const { error } = await sb.from("eve_liquidity_price_alarms").update({ is_active: false, acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("is_triggered", true).is("acknowledged_at", null); if (error) throw error; return true; }

async function checkPriceAlarms(sb, liquidityRows) {
  const rowsWithPrices = (liquidityRows || []).filter((r) => Number.isFinite(Number(r.latest_price)) && r.is_open && !r.is_stale);
  if (!rowsWithPrices.length) return { checked: 0, triggered: 0 };
  const symbols = [...new Set(rowsWithPrices.map((r) => r.symbol))];
  const { data: alarms, error } = await sb.from("eve_liquidity_price_alarms").select("id,symbol,target_price,trigger_direction,last_checked_price").eq("is_active", true).eq("is_triggered", false).in("symbol", symbols);
  if (error) { if (String(error.message || "").toLowerCase().includes("eve_liquidity_price_alarms")) return { checked: 0, triggered: 0 }; throw error; }
  if (!alarms || !alarms.length) return { checked: 0, triggered: 0 };
  const priceBySymbol = new Map(rowsWithPrices.map((r) => [r.symbol, Number(r.latest_price)]));
  const nowIso = new Date().toISOString();
  let triggered = 0;
  for (const alarm of alarms) {
    const current = priceBySymbol.get(alarm.symbol);
    if (!Number.isFinite(current)) continue;
    const target = Number(alarm.target_price);
    const hit = alarm.trigger_direction === "above" ? current >= target : current <= target;
    const update = { last_checked_price: current, last_checked_at: nowIso, updated_at: nowIso };
    if (hit) { update.is_triggered = true; update.is_active = false; update.triggered_at = nowIso; triggered += 1; }
    const { error: updateError } = await sb.from("eve_liquidity_price_alarms").update(update).eq("id", alarm.id);
    if (updateError) throw updateError;
  }
  return { checked: alarms.length, triggered };
}

module.exports = {
  DEFAULT_MARKETS,
  runScan,
  getLatestResults,
  setScannerEnabled,
  createPriceAlarm,
  createLiquidityAlarm,
  deletePriceAlarm,
  acknowledgePriceAlarm,
  acknowledgeAllTriggeredAlarms,
  loadPriceAlarms,
  marketOpenInfo,
  nextStaggeredScanIso
};
