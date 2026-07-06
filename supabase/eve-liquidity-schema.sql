-- EVE Liquidity - Zone-Aware Liquidity Engine
-- Run this in the SAME Supabase project used by the other EVE scanners.
-- This creates separate EVE Liquidity tables. It reads EVE Zones results but does not modify them.

create extension if not exists pgcrypto;

create table if not exists public.eve_liquidity_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  changed_by text
);

create table if not exists public.eve_liquidity_markets (
  id bigserial primary key,
  symbol text not null unique,
  display_name text not null,
  asset_class text not null check (asset_class in ('forex', 'metal', 'crypto')),
  enabled boolean not null default true,
  scan_priority int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eve_liquidity_scan_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  mode text not null default 'starting',
  scanner_enabled boolean not null default true,
  source text not null default 'scheduled',
  markets_requested int not null default 0,
  markets_scanned int not null default 0,
  markets_open int not null default 0,
  top_symbol text,
  top_level_key text,
  notes text,
  errors jsonb not null default '[]'::jsonb
);

create table if not exists public.eve_liquidity_market_results (
  id bigserial primary key,
  scan_id uuid not null references public.eve_liquidity_scan_runs(id) on delete cascade,
  symbol text not null,
  display_name text not null,
  asset_class text not null check (asset_class in ('forex', 'metal', 'crypto')),
  is_open boolean not null default false,
  is_stale boolean not null default false,
  rank int,
  latest_price numeric,
  latest_candle_at timestamptz,

  demand_low numeric,
  demand_high numeric,
  demand_quality numeric,
  demand_status text,

  supply_low numeric,
  supply_high numeric,
  supply_quality numeric,
  supply_status text,

  demand_sweep_price numeric,
  demand_sweep_type text,
  demand_sweep_quality numeric,
  demand_sweep_reason text,

  demand_target_price numeric,
  demand_target_type text,
  demand_target_quality numeric,
  demand_target_reason text,

  supply_sweep_price numeric,
  supply_sweep_type text,
  supply_sweep_quality numeric,
  supply_sweep_reason text,

  supply_target_price numeric,
  supply_target_type text,
  supply_target_quality numeric,
  supply_target_reason text,

  best_quality numeric not null default 0,
  status text not null,
  reason text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.eve_liquidity_price_alarms (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  target_price numeric not null,
  trigger_direction text not null check (trigger_direction in ('above', 'below')),
  label text,
  level_key text check (level_key in ('demand_sweep', 'demand_target', 'supply_sweep', 'supply_target') or level_key is null),
  is_active boolean not null default true,
  is_triggered boolean not null default false,
  triggered_at timestamptz,
  acknowledged_at timestamptz,
  last_checked_price numeric,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eve_liquidity_scan_runs_started_at_idx
  on public.eve_liquidity_scan_runs(started_at desc);

create index if not exists eve_liquidity_market_results_scan_id_idx
  on public.eve_liquidity_market_results(scan_id);

create index if not exists eve_liquidity_market_results_symbol_created_idx
  on public.eve_liquidity_market_results(symbol, created_at desc);

create index if not exists eve_liquidity_price_alarms_symbol_active_idx
  on public.eve_liquidity_price_alarms(symbol, is_active, is_triggered);

create index if not exists eve_liquidity_price_alarms_triggered_idx
  on public.eve_liquidity_price_alarms(is_triggered, acknowledged_at, created_at desc);

insert into public.eve_liquidity_settings (key, value, updated_at, changed_by)
values ('liquidity_scanner_enabled', 'true'::jsonb, now(), 'setup')
on conflict (key) do update set value = excluded.value, updated_at = now(), changed_by = 'setup';

insert into public.eve_liquidity_markets (symbol, display_name, asset_class, enabled, scan_priority)
values
  ('EUR/USD', 'Euro / Dollar', 'forex', true, 1),
  ('GBP/USD', 'Pound / Dollar', 'forex', true, 2),
  ('AUD/USD', 'Aussie / Dollar', 'forex', true, 3),
  ('USD/JPY', 'Dollar / Yen', 'forex', true, 4),
  ('USD/CAD', 'Dollar / Cad', 'forex', true, 5),
  ('EUR/JPY', 'Euro / Yen', 'forex', true, 6),
  ('GBP/JPY', 'Pound / Yen', 'forex', true, 7),
  ('XAU/USD', 'Gold', 'metal', true, 8),
  ('BTC/USD', 'Bitcoin', 'crypto', true, 9)
on conflict (symbol) do update set
  display_name = excluded.display_name,
  asset_class = excluded.asset_class,
  enabled = excluded.enabled,
  scan_priority = excluded.scan_priority,
  updated_at = now();

alter table public.eve_liquidity_settings enable row level security;
alter table public.eve_liquidity_markets enable row level security;
alter table public.eve_liquidity_scan_runs enable row level security;
alter table public.eve_liquidity_market_results enable row level security;
alter table public.eve_liquidity_price_alarms enable row level security;

-- Service role bypasses RLS automatically. No public policies are needed.
