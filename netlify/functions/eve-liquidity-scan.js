const { schedule } = require("@netlify/functions");
const { runScan } = require("./lib/eve-liquidity-core");

const scheduledHandler = async () => {
  try {
    const result = await runScan({ source: "scheduled" });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error("EVE Liquidity scheduled scan failed:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message || String(err) }) };
  }
};

// Staggered 3 minutes after EVE Bias: 03, 08, 13, 18, ...
exports.handler = schedule("3,8,13,18,23,28,33,38,43,48,53,58 * * * *", scheduledHandler);
