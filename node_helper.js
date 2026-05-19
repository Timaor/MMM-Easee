/* MagicMirror² Module Helper: MMM-Easee-Status */

const NodeHelper = require("node_helper");
const axios = require("axios");

module.exports = NodeHelper.create({
  start() {
    this.config = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.timer = null;
    this.client = axios.create({
      baseURL: "https://api.easee.com/api",
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    });
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "EASEE_CONFIG") return;

    this.config = payload;

    if (!this.config.username || !this.config.password || !this.config.chargerId) {
      this.sendSocketNotification("EASEE_ERROR", {
        message: "Mangler username, password eller chargerId i config.js"
      });
      return;
    }

    this.fetchAndSend();

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.fetchAndSend(), this.config.updateInterval || 60000);
  },

  async login() {
    const response = await this.client.post("/accounts/login", {
      userName: this.config.username,
      password: this.config.password
    });

    this.accessToken = response.data.accessToken;
    this.refreshToken = response.data.refreshToken;
  },

  async refreshLogin() {
    if (!this.refreshToken) {
      await this.login();
      return;
    }

    try {
      const response = await this.client.post("/accounts/refresh_token", {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken
      });

      this.accessToken = response.data.accessToken;
      this.refreshToken = response.data.refreshToken;
    } catch (error) {
      this.accessToken = null;
      this.refreshToken = null;
      await this.login();
    }
  },

  authHeaders() {
    return {
      Authorization: `Bearer ${this.accessToken}`
    };
  },

  async apiGet(path) {
    if (!this.accessToken) await this.login();

    try {
      return await this.client.get(path, { headers: this.authHeaders() });
    } catch (error) {
      if (error.response && error.response.status === 401) {
        await this.refreshLogin();
        return await this.client.get(path, { headers: this.authHeaders() });
      }
      throw error;
    }
  },

  async fetchAndSend() {
    try {
      const state = await this.fetchChargerState();
      const observations = await this.fetchObservationsSafely();
      const normalized = this.normalizeState(state, observations);

      if (this.config.debug) {
        console.log("MMM-Easee-Status normalized:", normalized);
      }

      this.sendSocketNotification("EASEE_STATUS", normalized);
    } catch (error) {
      const message = this.makeFriendlyError(error);
      console.error("MMM-Easee-Status:", message);
      this.sendSocketNotification("EASEE_ERROR", { message });
    }
  },

  async fetchChargerState() {
    const chargerId = encodeURIComponent(this.config.chargerId);
    const response = await this.apiGet(`/chargers/${chargerId}/state`);
    return response.data || {};
  },

  async fetchObservationsSafely() {
    try {
      const chargerId = encodeURIComponent(this.config.chargerId);
      const response = await this.apiGet(`/chargers/${chargerId}/observations`);
      return response.data || [];
    } catch (error) {
      if (this.config.debug) {
        console.warn("MMM-Easee-Status: observations endpoint failed, using state only", error.message);
      }
      return [];
    }
  },

  normalizeState(state, observations) {
    const observationMap = this.observationsToMap(observations);

    const dynamicCurrent = this.firstDefined([
      state.dynamicChargerCurrent,
      state.dynamicCurrent,
      state.dynamicCircuitCurrentP1,
      state.dynamicCircuitCurrent,
      observationMap[48],
      observationMap.dynamicChargerCurrent,
      observationMap.DynamicChargerCurrent
    ]);

    const powerRaw = this.firstDefined([
      state.totalPower,
      state.chargerPower,
      state.outputPower,
      state.activePower,
      state.power,
      observationMap[37],
      observationMap[38],
      observationMap.totalPower,
      observationMap.TotalPower
    ]);

    const powerKw = this.toKw(powerRaw);

    const opModeRaw = this.firstDefined([
      state.chargerOpMode,
      state.chargerMode,
      state.status,
      state.state,
      observationMap[109],
      observationMap.chargerOpMode,
      observationMap.ChargerOpMode
    ]);

    const status = this.normalizeStatus(opModeRaw, powerKw, state);

    const connected = this.normalizeConnected(state, observationMap, status, powerKw);

    return {
      connected,
      powerKw,
      dynamicCurrent: this.toNumberOrNull(dynamicCurrent),
      status,
      statusLabel: this.humanStatus(status),
      rawStatus: opModeRaw
    };
  },

  observationsToMap(observations) {
    const map = {};

    if (Array.isArray(observations)) {
      observations.forEach((item) => {
        const id = item.id ?? item.observationId ?? item.type ?? item.name;
        const value = item.value ?? item.Value ?? item.data ?? item.observationValue;
        if (id !== undefined) map[id] = value;
        if (item.name) map[item.name] = value;
      });
    } else if (observations && typeof observations === "object") {
      Object.entries(observations).forEach(([key, value]) => {
        if (value && typeof value === "object" && "value" in value) {
          map[key] = value.value;
        } else {
          map[key] = value;
        }
      });
    }

    return map;
  },

  normalizeConnected(state, observationMap, status, powerKw) {
    const direct = this.firstDefined([
      state.carConnected,
      state.cableLocked,
      state.isCableLocked,
      state.cableConnected,
      state.vehicleConnected,
      observationMap.carConnected,
      observationMap.CarConnected,
      observationMap[103],
      observationMap[106]
    ]);

    if (typeof direct === "boolean") return direct;
    if (typeof direct === "number") return direct > 0;
    if (typeof direct === "string") {
      const lower = direct.toLowerCase();
      if (["true", "connected", "locked", "1", "yes"].includes(lower)) return true;
      if (["false", "disconnected", "unlocked", "0", "no"].includes(lower)) return false;
    }

    if (powerKw > 0) return true;
    return !["disconnected", "offline", "unknown"].includes(status);
  },

  normalizeStatus(value, powerKw, state) {
    if (powerKw > 0) return "charging";

    if (value === null || value === undefined || value === "") {
      if (state.carConnected || state.cableLocked) return "ready";
      return "unknown";
    }

    const numericMap = {
      0: "offline",
      1: "disconnected",
      2: "awaiting_start",
      3: "charging",
      4: "completed",
      5: "error",
      6: "ready"
    };

    if (typeof value === "number" && numericMap[value]) return numericMap[value];

    const lower = String(value).toLowerCase().replace(/\s+/g, "_");

    if (lower.includes("charg")) return "charging";
    if (lower.includes("ready")) return "ready";
    if (lower.includes("disconnect")) return "disconnected";
    if (lower.includes("complete")) return "completed";
    if (lower.includes("await") || lower.includes("start")) return "awaiting_start";
    if (lower.includes("error") || lower.includes("fault")) return "error";
    if (lower.includes("offline")) return "offline";

    return lower;
  },

  humanStatus(status) {
    const labels = {
      charging: "Charging",
      ready: "Ready",
      ready_to_charge: "Ready",
      disconnected: "Disconnected",
      awaiting_start: "Awaiting start",
      completed: "Completed",
      error: "Error",
      offline: "Offline",
      unknown: "Unknown"
    };

    return labels[status] || String(status || "Unknown");
  },

  toKw(value) {
    const number = this.toNumberOrNull(value);
    if (number === null) return 0;

    // Easee/state integrations may expose W or kW depending on endpoint/integration.
    if (Math.abs(number) > 100) return Number((number / 1000).toFixed(1));
    return Number(number.toFixed(1));
  },

  toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  },

  firstDefined(values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  },

  makeFriendlyError(error) {
    if (error.response) {
      return `Easee API-feil ${error.response.status}`;
    }

    if (error.code === "ECONNABORTED") return "Timeout mot Easee API";
    if (error.message) return error.message;
    return "Ukjent Easee-feil";
  }
});
