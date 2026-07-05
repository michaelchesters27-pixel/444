# EVE Liquidity

Zone-Aware Liquidity Engine for M5 / M1 trading.

EVE Liquidity is a separate Netlify scanner that uses the same Supabase project as the other EVE tools, but has its own tables.

It reads the latest supply and demand zones from EVE Zones, then scans fresh H1 / M15 / M5 candles from Twelve Data to find meaningful liquidity around those zones.

It does not use WebSocket.
It runs at 03, 08, 13, 18... minutes to avoid clashing with the other EVE scanners.

## What it shows

For every asset:

- Demand zone from EVE Zones
- Sweep risk below demand
- Target above demand
- Supply zone from EVE Zones
- Sweep risk above supply
- Target below supply
- Liquidity quality
- Custom price alarms
- Liquidity level alarms

If no meaningful liquidity exists, it says so. It does not force tiny nearby highs/lows.

## Netlify variables

Set these in the EVE Liquidity Netlify site:

```text
TWELVEDATA_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
EVE_ADMIN_PASSWORD
```

## Supabase

Run:

```text
supabase/eve-liquidity-schema.sql
```

Use the same Supabase project as EVE Bias / Zones / Structure.

## Netlify build settings

This ZIP is flat. Use simple settings:

```text
Base directory: /
Package directory: Not set / blank
Build command: npm run build
Publish directory: public
Functions directory: netlify/functions
```
