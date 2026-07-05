const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-eve-admin-password",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body)
  };
}

function options() {
  return { statusCode: 204, headers: jsonHeaders, body: "" };
}

function parseBody(event) {
  if (!event || !event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (err) {
    return {};
  }
}

function requireAdmin(event) {
  const expected = process.env.EVE_ADMIN_PASSWORD;
  if (!expected) {
    return { ok: false, error: "EVE_ADMIN_PASSWORD is not set in Netlify environment variables." };
  }

  const body = parseBody(event);
  const supplied =
    event.headers?.["x-eve-admin-password"] ||
    event.headers?.["X-Eve-Admin-Password"] ||
    body.admin_password ||
    body.password;

  if (!supplied || supplied !== expected) {
    return { ok: false, error: "Admin password missing or incorrect." };
  }

  return { ok: true };
}

module.exports = { json, options, parseBody, requireAdmin, jsonHeaders };
