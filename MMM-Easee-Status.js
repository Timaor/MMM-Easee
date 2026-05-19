/* MagicMirror² Module: MMM-Easee-Status
 * Shows Easee charger connection state, charging power and dynamic current.
 */

Module.register("MMM-Easee-Status", {
  defaults: {
    title: "Easee",
    username: "",
    password: "",
    chargerId: "",
    siteId: "",
    updateInterval: 60 * 1000,
    retryInterval: 5 * 60 * 1000,
    animationSpeed: 750,
    showChargerImage: true,
    showCarImage: true,
    showIcons: true,
    useMetricLocale: true,
    debug: false
  },

  start() {
    this.easee = null;
    this.loaded = false;
    this.error = null;
    this.sendSocketNotification("EASEE_CONFIG", this.config);
  },

  getStyles() {
    return ["MMM-Easee-Status.css"];
  },

  getTranslations() {
    return {
      nb: "translations/nb.json",
      en: "translations/en.json"
    };
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "EASEE_STATUS") {
      this.easee = payload;
      this.loaded = true;
      this.error = null;
      this.updateDom(this.config.animationSpeed);
    }

    if (notification === "EASEE_ERROR") {
      this.error = payload;
      this.loaded = true;
      this.updateDom(this.config.animationSpeed);
    }
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-easee-card";

    const visual = document.createElement("div");
    visual.className = "mmm-easee-visual";

    if (this.config.showChargerImage) {
      const charger = document.createElement("div");
      charger.className = "mmm-easee-charger";
      charger.innerHTML = `
        <div class="charger-body">
          <div class="charger-brand">easee</div>
          <div class="charger-led ${this.getAccentStateClass()}"></div>
          <div class="charger-cable"></div>
        </div>
      `;
      visual.appendChild(charger);
    }

    if (this.config.showCarImage) {
      const car = document.createElement("div");
      car.className = "mmm-easee-car";
      car.innerHTML = `
        <div class="car-roof"></div>
        <div class="car-body"></div>
        <div class="car-light"></div>
        <div class="car-wheel wheel-left"></div>
        <div class="car-wheel wheel-right"></div>
        <div class="charge-port ${this.getAccentStateClass()}"></div>
        <div class="charge-cable"></div>
      `;
      visual.appendChild(car);
    }

    wrapper.appendChild(visual);

    const panel = document.createElement("div");
    panel.className = "mmm-easee-panel";

    const title = document.createElement("div");
    title.className = "mmm-easee-title";
    title.innerText = this.config.title;
    panel.appendChild(title);

    const divider = document.createElement("div");
    divider.className = "mmm-easee-divider";
    panel.appendChild(divider);

    if (!this.loaded) {
      panel.appendChild(this.makeLoadingRow("Henter Easee-data..."));
      wrapper.appendChild(panel);
      return wrapper;
    }

    if (this.error) {
      panel.appendChild(this.makeErrorRow(this.error.message || "API-feil"));
      wrapper.appendChild(panel);
      return wrapper;
    }

    const data = this.easee || {};

    panel.appendChild(this.makeRow({
      icon: this.carIcon(),
      label: "Bil:",
      value: data.connected ? "Tilkoblet" : "Ikke tilkoblet",
      accent: data.connected
    }));

    panel.appendChild(this.makeRow({
      icon: this.lightningIcon(),
      label: "Lading:",
      value: `${this.formatPower(data.powerKw)} kW`,
      accent: Number(data.powerKw) > 0
    }));

    panel.appendChild(this.makeRow({
      icon: this.currentIcon(),
      label: "Dynamic current:",
      value: `${this.formatAmp(data.dynamicCurrent)} A`,
      accent: data.dynamicCurrent !== null && data.dynamicCurrent !== undefined
    }));

    panel.appendChild(this.makeRow({
      icon: this.statusIcon(),
      label: "Status:",
      value: data.statusLabel || data.status || "Ukjent",
      accent: this.isPositiveStatus(data.status)
    }));

    wrapper.appendChild(panel);
    return wrapper;
  },

  makeRow({ icon, label, value, accent }) {
    const row = document.createElement("div");
    row.className = "mmm-easee-row";

    const left = document.createElement("div");
    left.className = "mmm-easee-row-left";

    const statusDot = document.createElement("span");
    statusDot.className = `mmm-easee-dot ${accent ? "active" : "idle"}`;
    left.appendChild(statusDot);

    if (this.config.showIcons) {
      const iconBox = document.createElement("span");
      iconBox.className = "mmm-easee-icon";
      iconBox.innerHTML = icon;
      left.appendChild(iconBox);
    }

    const labelEl = document.createElement("span");
    labelEl.className = "mmm-easee-label";
    labelEl.innerText = label;
    left.appendChild(labelEl);

    const valueEl = document.createElement("div");
    valueEl.className = `mmm-easee-value ${accent ? "accent" : "muted"}`;
    valueEl.innerText = value;

    row.appendChild(left);
    row.appendChild(valueEl);
    return row;
  },

  makeLoadingRow(text) {
    const row = document.createElement("div");
    row.className = "mmm-easee-loading";
    row.innerText = text;
    return row;
  },

  makeErrorRow(text) {
    const row = document.createElement("div");
    row.className = "mmm-easee-error";
    row.innerText = text;
    return row;
  },

  formatPower(value) {
    const number = Number(value || 0);
    return number.toLocaleString(this.config.useMetricLocale ? "nb-NO" : undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  },

  formatAmp(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (Number.isNaN(number)) return String(value);
    return number.toLocaleString(this.config.useMetricLocale ? "nb-NO" : undefined, {
      maximumFractionDigits: 0
    });
  },

  isPositiveStatus(status) {
    const positive = ["charging", "ready", "ready_to_charge", "awaiting_start", "completed"];
    return positive.includes(String(status || "").toLowerCase());
  },

  getAccentStateClass() {
    if (!this.easee) return "idle";
    if (Number(this.easee.powerKw) > 0) return "charging";
    if (this.easee.connected) return "ready";
    return "idle";
  },

  carIcon() {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 34l5-13c1-3 4-5 8-5h10c4 0 7 2 8 5l5 13"/><path d="M12 34h40c3 0 6 3 6 6v9H6v-9c0-3 3-6 6-6z"/><circle cx="18" cy="49" r="5"/><circle cx="46" cy="49" r="5"/><path d="M22 27h20"/></svg>`;
  },

  lightningIcon() {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M36 4L12 36h18l-4 24 26-34H34z"/></svg>`;
  },

  currentIcon() {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="23"/><path d="M32 16v16l12 7"/><path d="M23 43l9-23 9 23"/><path d="M27 35h10"/></svg>`;
  },

  statusIcon() {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24"/><path d="M32 13v19l13 13"/><path d="M48 16l4-4"/><path d="M12 12l4 4"/></svg>`;
  }
});
