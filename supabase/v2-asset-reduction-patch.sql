-- EVE Liquidity v2 asset-reduction patch
-- Keeps BTC and Gold. Disables Silver, ETH and SOL.

update public.eve_liquidity_markets
set enabled = false, updated_at = now()
where symbol in ('XAG/USD', 'ETH/USD', 'SOL/USD');

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
