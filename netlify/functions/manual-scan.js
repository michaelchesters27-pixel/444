const { runScan } = require("./lib/eve-liquidity-core");
const { json, options, requireAdmin } = require("./lib/http");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST required" });
  const auth = requireAdmin(event);
  if (!auth.ok) return json(401, { ok: false, error: auth.error });
  try {
    const result = await runScan({ source: "manual", force: false });
    return json(200, result);
  } catch (err) {
    console.error("manual-scan error:", err);
    return json(500, { ok: false, error: err.message || String(err) });
  }
};
