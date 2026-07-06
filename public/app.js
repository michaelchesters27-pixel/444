const state = {
  data: null,
  loading: false,
  adminPassword: localStorage.getItem("eve_admin_password") || "",
  alarmSoundEnabled: localStorage.getItem("eve_alarm_sound_enabled") === "true",
  playedAlarmIds: new Set()
};

const $ = (id) => document.getElementById(id);

function fmtTime(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
}

function fmtDateTime(iso) {
  if (!iso) return "waiting for first result";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "waiting for first result";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
}

function showToast(msg) {
  const toast = $("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 4200);
}

function setClock() { $("ukClock").textContent = fmtTime(new Date().toISOString()); }

function modeLabel(mode) {
  if (!mode) return "Waiting";
  if (mode === "weekend_crypto_only") return "Weekend: Crypto Only";
  if (mode === "liquidity_scanner_off") return "Scanner Off";
  if (mode === "weekday") return "Weekday Markets";
  if (mode === "api_safety_delay") return "API Safety Delay";
  return String(mode).replaceAll("_", " ");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.adminPassword ? { "x-eve-admin-password": state.adminPassword } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

async function loadLatest() {
  if (state.loading) return;
  state.loading = true;
  try {
    const data = await api("/.netlify/functions/latest-results");
    state.data = data;
    render(data);
  } catch (err) {
    showToast(err.message || "Could not load EVE Liquidity results");
  } finally {
    state.loading = false;
  }
}

function render(data) {
  const run = data.latest_run;
  const scannerEnabled = data.scanner_enabled !== false;
  $("scannerState").textContent = scannerEnabled ? "ON" : "OFF";
  $("marketMode").textContent = modeLabel(run?.mode);
  $("nextScan").textContent = fmtTime(data.next_scan_at);
  $("lastScan").textContent = `Last scan: ${fmtDateTime(run?.completed_at || run?.started_at)}`;
  $("openCount").textContent = `Markets open: ${run?.markets_open ?? 0} / ${run?.markets_requested ?? 9}`;
  $("coreStatus").textContent = scannerEnabled ? "SCANNING" : "PAUSED";
  $("toggleBtn").textContent = scannerEnabled ? "Turn Scanner Off" : "Turn Scanner On";
  $("soundBtn").textContent = state.alarmSoundEnabled ? "Alarm Sound Enabled" : "Enable Alarm Sound";

  renderTop(data.top_liquidity);
  renderLeaders(data.leaders || {});
  renderGrid(data.markets || [], data.price_alarms || []);
  renderAlarmPanel(data.price_alarms || []);
  renderTable(data.markets || []);
  handleTriggeredAlarms(data.price_alarms || []);
}

function levelClass(key) {
  if (String(key || "").includes("target")) return "bias-bullish";
  if (String(key || "").includes("sweep")) return "bias-bearish";
  return "bias-mixed";
}

function renderTop(top) {
  const empty = $("topPickEmpty");
  const content = $("topPickContent");
  if (!top) {
    empty.classList.remove("hidden");
    content.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  content.classList.remove("hidden");
  $("topSymbol").textContent = top.symbol;
  $("topScore").textContent = Math.round(Number(top.quality || 0));
  $("topReason").textContent = top.reason || "No reason saved.";
  const pill = $("topLevelType");
  pill.textContent = `${labelKey(top.level_key)} • ${formatPrice(top.price, top.symbol)}`;
  pill.className = `bias-pill ${levelClass(top.level_key)}`;
}

function renderLeaderCard(id, row, priceField, qualityField, label) {
  const el = $(id);
  const strong = el.querySelector("strong");
  const small = el.querySelector("small");
  if (!row || !row[priceField]) {
    strong.textContent = "--";
    small.textContent = "No meaningful level";
    return;
  }
  strong.textContent = row.symbol;
  small.textContent = `${Math.round(Number(row[qualityField] || 0))}% • ${label} • ${formatPrice(row[priceField], row.symbol)}`;
}

function renderLeaders(leaders) {
  renderLeaderCard("leaderDemandSweep", leaders.topDemandSweep, "demand_sweep_price", "demand_sweep_quality", "below demand");
  renderLeaderCard("leaderDemandTarget", leaders.topDemandTarget, "demand_target_price", "demand_target_quality", "above demand");
  renderLeaderCard("leaderSupplySweep", leaders.topSupplySweep, "supply_sweep_price", "supply_sweep_quality", "above supply");
  renderLeaderCard("leaderSupplyTarget", leaders.topSupplyTarget, "supply_target_price", "supply_target_quality", "below supply");
}

function latestAlarmForSymbol(alarms, symbol) {
  return (alarms || []).find((a) => a.symbol === symbol && !a.acknowledged_at) || null;
}

function formatPrice(value, symbol = "") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  let dp = 2;
  if (symbol.includes("JPY")) dp = 3;
  else if (["EUR/USD", "GBP/USD", "AUD/USD", "USD/CAD"].includes(symbol)) dp = 5;
  else if (symbol.includes("BTC")) dp = 0;
  else if (symbol.includes("ETH")) dp = 1;
  else if (symbol.includes("SOL")) dp = 2;
  else if (symbol.includes("XAG")) dp = 3;
  return n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function formatZone(low, high, symbol) {
  if (!low || !high) return "--";
  return `${formatPrice(low, symbol)} – ${formatPrice(high, symbol)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

function labelKey(key) {
  const map = {
    demand_sweep: "Demand Sweep",
    demand_target: "Demand Target",
    supply_sweep: "Supply Sweep",
    supply_target: "Supply Target"
  };
  return map[key] || String(key || "Liquidity").replaceAll("_", " ");
}

function levelBox(title, price, type, quality, symbol, emptyText) {
  if (!price) return `<div class="zone-box"><span>${title}</span><strong>${emptyText}</strong><small>Strict filter</small></div>`;
  return `<div class="zone-box">
    <span>${title}</span>
    <strong>${formatPrice(price, symbol)}</strong>
    <small>${Math.round(Number(quality || 0))}% • ${escapeHtml(type || "liquidity")}</small>
  </div>`;
}

function renderGrid(markets, alarms) {
  const grid = $("marketGrid");
  if (!markets.length) {
    grid.innerHTML = `<div class="empty-state">No liquidity scans saved yet.</div>`;
    return;
  }
  grid.innerHTML = markets.map((m) => {
    const score = Math.round(Number(m.best_quality || 0));
    const classes = ["market-card"];
    if (!m.is_open || m.is_stale) classes.push("closed");
    if (score >= 75) classes.push("hot");
    else if (score < 55 && m.is_open) classes.push("choppy");
    const rank = m.rank ? `#${m.rank}` : (m.is_open ? "OPEN" : "CLOSED");
    const alarm = latestAlarmForSymbol(alarms, m.symbol);
    const alarmText = alarm ? `${alarm.is_triggered ? "ALARM HIT" : "Alarm"} ${alarm.trigger_direction} ${formatPrice(alarm.target_price, m.symbol)}` : "Custom Alarm";

    return `
      <article class="${classes.join(" ")}">
        <div class="market-meta"><span>${rank}</span><span>${escapeHtml(m.asset_class || "")}</span></div>
        <div class="market-symbol">${escapeHtml(m.symbol)}</div>
        <div class="price-row">Latest: <strong>${formatPrice(m.latest_price, m.symbol)}</strong></div>
        <div class="zone-pair">
          <div class="zone-box demand-zone">
            <span>Demand Zone</span>
            <strong>${m.demand_low && m.demand_high ? formatZone(m.demand_low, m.demand_high, m.symbol) : "No valid demand"}</strong>
            <small>From EVE Zones</small>
          </div>
          <div class="zone-box supply-zone">
            <span>Supply Zone</span>
            <strong>${m.supply_low && m.supply_high ? formatZone(m.supply_low, m.supply_high, m.symbol) : "No valid supply"}</strong>
            <small>From EVE Zones</small>
          </div>
        </div>
        <div class="zone-pair liquidity-pair">
          ${levelBox("Sweep Below Demand", m.demand_sweep_price, m.demand_sweep_type, m.demand_sweep_quality, m.symbol, "No meaningful sweep")}
          ${levelBox("Target Above Demand", m.demand_target_price, m.demand_target_type, m.demand_target_quality, m.symbol, "No meaningful target")}
        </div>
        <div class="zone-pair liquidity-pair">
          ${levelBox("Sweep Above Supply", m.supply_sweep_price, m.supply_sweep_type, m.supply_sweep_quality, m.symbol, "No meaningful sweep")}
          ${levelBox("Target Below Supply", m.supply_target_price, m.supply_target_type, m.supply_target_quality, m.symbol, "No meaningful target")}
        </div>
        <div class="market-line"><div class="pulse-meter"><div style="width:${score}%"></div></div><div class="score-mini">${score}%</div></div>
        <p class="card-reason">${escapeHtml(m.reason || m.status || "No reason saved.")}</p>
        <div class="alarm-button-row two-line">
          <button class="alarm-btn small level-alarm" data-symbol="${escapeHtml(m.symbol)}" data-level="demand_sweep">Demand Sweep</button>
          <button class="alarm-btn small level-alarm" data-symbol="${escapeHtml(m.symbol)}" data-level="demand_target">Demand Target</button>
          <button class="alarm-btn small level-alarm" data-symbol="${escapeHtml(m.symbol)}" data-level="supply_sweep">Supply Sweep</button>
          <button class="alarm-btn small level-alarm" data-symbol="${escapeHtml(m.symbol)}" data-level="supply_target">Supply Target</button>
        </div>
        <button class="alarm-btn custom-alarm ${alarm?.is_triggered ? "alarm-hit" : ""}" data-symbol="${escapeHtml(m.symbol)}" data-price="${m.latest_price || ""}">${escapeHtml(alarmText)}</button>
      </article>
    `;
  }).join("");
}

function renderAlarmPanel(alarms) {
  const list = $("alarmList");
  if (!alarms.length) {
    list.innerHTML = `<div class="alarm-empty">No price alarms set.</div>`;
    return;
  }
  list.innerHTML = alarms.map((a) => {
    const stateText = a.acknowledged_at ? "Acknowledged" : a.is_triggered ? "Triggered" : a.is_active ? "Active" : "Inactive";
    const classes = ["alarm-item"];
    if (a.is_triggered && !a.acknowledged_at) classes.push("triggered");
    return `
      <div class="${classes.join(" ")}">
        <div>
          <strong>${escapeHtml(a.symbol)}</strong>
          <span>${stateText} • ${escapeHtml(a.label || labelKey(a.level_key) || "price alarm")} • ${a.trigger_direction} ${formatPrice(a.target_price, a.symbol)}</span>
          <small>Last checked: ${formatPrice(a.last_checked_price, a.symbol)} ${a.last_checked_at ? `at ${fmtTime(a.last_checked_at)}` : ""}</small>
        </div>
        <div class="alarm-actions">
          ${a.is_triggered && !a.acknowledged_at ? `<button class="ghost-btn ack-alarm" data-id="${a.id}">Acknowledge</button>` : ""}
          <button class="ghost-btn delete-alarm" data-id="${a.id}">Delete</button>
        </div>
      </div>`;
  }).join("");
}

function renderTable(markets) {
  const body = $("rankingBody");
  if (!markets.length) {
    body.innerHTML = `<tr><td colspan="9">No liquidity scans saved yet.</td></tr>`;
    return;
  }
  body.innerHTML = markets.map((m) => `
    <tr>
      <td>${m.rank || "—"}</td>
      <td><strong>${escapeHtml(m.symbol)}</strong></td>
      <td>${m.demand_sweep_price ? `${formatPrice(m.demand_sweep_price, m.symbol)} (${Math.round(m.demand_sweep_quality || 0)}%)` : "—"}</td>
      <td>${m.demand_target_price ? `${formatPrice(m.demand_target_price, m.symbol)} (${Math.round(m.demand_target_quality || 0)}%)` : "—"}</td>
      <td>${m.supply_sweep_price ? `${formatPrice(m.supply_sweep_price, m.symbol)} (${Math.round(m.supply_sweep_quality || 0)}%)` : "—"}</td>
      <td>${m.supply_target_price ? `${formatPrice(m.supply_target_price, m.symbol)} (${Math.round(m.supply_target_quality || 0)}%)` : "—"}</td>
      <td>${formatPrice(m.latest_price, m.symbol)}</td>
      <td>${m.best_quality ? `${Math.round(m.best_quality)}%` : "—"}</td>
      <td>${escapeHtml(m.status || "")}</td>
    </tr>`).join("");
}

function handleTriggeredAlarms(alarms) {
  const active = alarms.filter((a) => a.is_triggered && !a.acknowledged_at);
  const banner = $("alarmBanner");
  if (!active.length) {
    banner.classList.add("hidden");
    return;
  }
  const first = active[0];
  $("alarmTitle").textContent = "EVE LIQUIDITY ALARM";
  $("alarmText").textContent = `${first.symbol} hit ${formatPrice(first.target_price, first.symbol)} (${first.label || labelKey(first.level_key) || first.trigger_direction})`;
  banner.classList.remove("hidden");
  if (state.alarmSoundEnabled) {
    for (const alarm of active) {
      if (!state.playedAlarmIds.has(alarm.id)) {
        state.playedAlarmIds.add(alarm.id);
        playAlarmSound();
      }
    }
  }
}

function playAlarmSound() {
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    setTimeout(() => { osc.frequency.value = 1180; }, 220);
    setTimeout(() => { osc.stop(); audio.close(); }, 850);
  } catch (err) {
    console.warn("Alarm sound blocked", err);
  }
}

async function postAlarm(body) {
  const result = await api("/.netlify/functions/price-alarms", { method: "POST", body: JSON.stringify(body) });
  showToast(result.message || "Alarm updated");
  await loadLatest();
}

function bindEvents() {
  $("refreshBtn").addEventListener("click", loadLatest);
  $("manualScanBtn").addEventListener("click", async () => {
    try {
      showToast("EVE Liquidity scan started...");
      const result = await api("/.netlify/functions/manual-scan", { method: "POST", body: JSON.stringify({}) });
      showToast(result.message || "Scan complete");
      await loadLatest();
    } catch (err) { showToast(err.message); }
  });
  $("toggleBtn").addEventListener("click", async () => {
    try {
      const enabled = !(state.data?.scanner_enabled !== false);
      const result = await api("/.netlify/functions/toggle-scanner", { method: "POST", body: JSON.stringify({ enabled }) });
      showToast(result.message || "Scanner setting updated");
      await loadLatest();
    } catch (err) { showToast(err.message); }
  });
  $("passwordBtn").addEventListener("click", () => {
    const value = prompt("Enter EVE admin password", state.adminPassword || "");
    if (value === null) return;
    state.adminPassword = value.trim();
    localStorage.setItem("eve_admin_password", state.adminPassword);
    showToast("Admin password saved in this browser.");
  });
  $("soundBtn").addEventListener("click", () => {
    state.alarmSoundEnabled = true;
    localStorage.setItem("eve_alarm_sound_enabled", "true");
    playAlarmSound();
    render(state.data || {});
    showToast("Alarm sound enabled.");
  });
  $("ackAllBtn").addEventListener("click", () => postAlarm({ action: "acknowledge_all" }).catch((err) => showToast(err.message)));
  $("ackBannerBtn").addEventListener("click", () => postAlarm({ action: "acknowledge_all" }).catch((err) => showToast(err.message)));

  document.body.addEventListener("click", async (event) => {
    const target = event.target;
    if (target.classList.contains("custom-alarm")) {
      const symbol = target.dataset.symbol;
      const latest = Number(target.dataset.price || 0);
      const input = prompt(`Set custom price alarm for ${symbol}`, latest ? String(latest) : "");
      if (!input) return;
      await postAlarm({ action: "create", symbol, target_price: Number(input), trigger_direction: "auto", label: "custom price" }).catch((err) => showToast(err.message));
    }
    if (target.classList.contains("level-alarm")) {
      await postAlarm({ action: "create_liquidity_alarm", symbol: target.dataset.symbol, level_key: target.dataset.level }).catch((err) => showToast(err.message));
    }
    if (target.classList.contains("delete-alarm")) {
      await postAlarm({ action: "delete", id: target.dataset.id }).catch((err) => showToast(err.message));
    }
    if (target.classList.contains("ack-alarm")) {
      await postAlarm({ action: "acknowledge", id: target.dataset.id }).catch((err) => showToast(err.message));
    }
  });
}

setClock();
setInterval(setClock, 1000);
bindEvents();
loadLatest();
setInterval(loadLatest, 30000);
