const { getLatestResults } = require("./lib/eve-liquidity-core");
const { json, options } = require("./lib/http");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  try {
    const result = await getLatestResults();
    return json(200, result);
  } catch (err) {
    console.error("latest-results error:", err);
    return json(500, { ok: false, error: err.message || String(err) });
  }
};
