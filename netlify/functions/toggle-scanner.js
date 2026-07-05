const { setScannerEnabled } = require("./lib/eve-liquidity-core");
const { json, options, parseBody, requireAdmin } = require("./lib/http");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST required" });
  const auth = requireAdmin(event);
  if (!auth.ok) return json(401, { ok: false, error: auth.error });
  try {
    const body = parseBody(event);
    if (typeof body.enabled !== "boolean") return json(400, { ok: false, error: "Body must include enabled: true or false" });
    const enabled = await setScannerEnabled(body.enabled, "dashboard");
    return json(200, { ok: true, scanner_enabled: enabled, message: enabled ? "EVE Liquidity scanner is ON" : "EVE Liquidity scanner is OFF. Scheduled runs will make 0 Twelve Data calls." });
  } catch (err) {
    console.error("toggle-scanner error:", err);
    return json(500, { ok: false, error: err.message || String(err) });
  }
};
