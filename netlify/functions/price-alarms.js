const {
  createPriceAlarm,
  createLiquidityAlarm,
  deletePriceAlarm,
  acknowledgePriceAlarm,
  acknowledgeAllTriggeredAlarms,
  loadPriceAlarms
} = require("./lib/eve-liquidity-core");
const { json, options, parseBody, requireAdmin } = require("./lib/http");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  try {
    if (event.httpMethod === "GET") {
      const alarms = await loadPriceAlarms();
      return json(200, { ok: true, price_alarms: alarms });
    }
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "GET or POST required" });
    const auth = requireAdmin(event);
    if (!auth.ok) return json(401, { ok: false, error: auth.error });
    const body = parseBody(event);
    const action = String(body.action || "create").toLowerCase();
    if (action === "create") {
      const alarm = await createPriceAlarm({ symbol: body.symbol, target_price: body.target_price, trigger_direction: body.trigger_direction || "auto", label: body.label || null, level_key: body.level_key || null });
      return json(200, { ok: true, alarm, message: `${alarm.symbol} alarm set at ${alarm.target_price}` });
    }
    if (action === "create_liquidity_alarm") {
      const alarm = await createLiquidityAlarm({ symbol: body.symbol, level_key: body.level_key });
      return json(200, { ok: true, alarm, message: `${alarm.symbol} ${alarm.level_key || "liquidity"} alarm set at ${alarm.target_price}` });
    }
    if (action === "delete") { await deletePriceAlarm(body.id); return json(200, { ok: true, message: "Alarm deleted" }); }
    if (action === "acknowledge") { const alarm = await acknowledgePriceAlarm(body.id); return json(200, { ok: true, alarm, message: "Alarm acknowledged" }); }
    if (action === "acknowledge_all") { await acknowledgeAllTriggeredAlarms(); return json(200, { ok: true, message: "Triggered alarms acknowledged" }); }
    return json(400, { ok: false, error: "Unknown alarm action" });
  } catch (err) {
    console.error("price-alarms error:", err);
    return json(500, { ok: false, error: err.message || String(err) });
  }
};
