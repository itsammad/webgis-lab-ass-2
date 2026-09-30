/* =====================================================================
   Pakistan Environmental Monitoring — Web GIS
   ---------------------------------------------------------------------
   * Fulfills Lab Assignment 1 Requirements: OSM/Satellite basemaps, 
     15+ cities, 15+ weather stations, custom popups & markers.
   ===================================================================== */

/* ---------- 1. FILES ---------- */
const DATA_FILES = {
  boundary:    "data/pakistan_boundary.geojson",
  cities:      "data/cities.geojson",
  stations:    "data/weatherstation.geojson",
  rainfall:    "data/rainfall.geojson",
  environment: "data/environment.geojson"
};

/* ---------- 2. FIELD AUTO-DETECTION ---------- */
const FIELD_ALIASES = {
  name:        ["stationname", "station", "sitename", "name", "location", "cityname", "city"],
  temperature: ["temperature", "temperaturec", "temp", "tempc", "airtemperature"],
  humidity:    ["humidity", "relativehumidity", "humiditypct", "rh", "hum"],
  rainfall:    ["rainfall", "rainfallmm", "rain", "rainmm", "precipitation", "precip"],
  aqi:         ["aqi", "airqualityindex", "aqivalue", "usaqi"],
  category:    ["aqicategory", "airqualitycategory", "category", "aqilevel", "airqualitylevel"],
  province:    ["province", "state", "region"],
  type:        ["type", "citytype", "class"]
};
const NUMERIC_FIELDS = ["temperature", "humidity", "rainfall", "aqi"];

const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : undefined;
  }
  return undefined;
}
function toText(v) {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (!s || ["null", "undefined", "nan", "n/a", "na", "-", "--"].includes(s.toLowerCase())) return undefined;
  return s;
}
function pick(props, field) {
  const keys = Object.keys(props || {});
  for (const alias of FIELD_ALIASES[field]) {
    for (const k of keys) {
      if (normKey(k) !== alias) continue;
      const val = NUMERIC_FIELDS.includes(field) ? toNumber(props[k]) : toText(props[k]);
      if (val !== undefined) return val;
    }
  }
  return undefined;
}

/* ---------- 3. AQI CATEGORIES (Monochromatic Amber & Ink) ---------- */
const AQI_LEVELS = [
  { max: 50,       label: "Good",                           color: "#f7e6c8", dark: true,  range: "0–50" },
  { max: 100,      label: "Moderate",                       color: "#e4b87c", dark: true,  range: "51–100" },
  { max: 150,      label: "Unhealthy for Sensitive Groups", color: "#c9985c", dark: true,  range: "101–150" },
  { max: 200,      label: "Unhealthy",                      color: "#f39c12", dark: true, range: "151–200" },
  { max: 300,      label: "Very Unhealthy",                 color: "#b45f06", dark: false, range: "201–300" },
  { max: Infinity, label: "Hazardous",                      color: "#3b2410", dark: false, range: "301+" }
];
const UNKNOWN_LEVEL = { label: "", color: "#9a5200", dark: false };

function levelFromAqi(aqi) {
  if (aqi === undefined) return undefined;
  return AQI_LEVELS.find(l => aqi <= l.max);
}
function levelFromText(text) {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (t.includes("hazard")) return AQI_LEVELS[5];
  if (t.includes("very")) return AQI_LEVELS[4];
  if (t.includes("sensitive")) return AQI_LEVELS[2];
  if (t.includes("unhealthy")) return AQI_LEVELS[3];
  if (t.includes("moderate")) return AQI_LEVELS[1];
  if (t.includes("good")) return AQI_LEVELS[0];
  return undefined;
}
function levelFor(rec) {
  return levelFromText(rec.category) || levelFromAqi(rec.aqi) || UNKNOWN_LEVEL;
}

/* ---------- 4. HELPERS (Monochromatic Steps) ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => String(+Number(n).toFixed(1));

function luminanceIsLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}
function scaleColor(v, steps) {
  for (const [max, color] of steps) if (v < max) return color;
  return steps[steps.length - 1][1];
}

const TEMP_STEPS = [[10, "#f7e6c8"], [18, "#e4b87c"], [25, "#c9985c"], [30, "#f39c12"], [35, "#b45f06"], [Infinity, "#3b2410"]];
const HUM_STEPS  = [[30, "#f7e6c8"], [50, "#e4b87c"], [70, "#c9985c"], [85, "#b45f06"], [Infinity, "#3b2410"]];
const RAIN_STEPS = [[0.05, "#f7e6c8"], [5, "#e4b87c"], [15, "#c9985c"], [30, "#b45f06"], [Infinity, "#3b2410"]];

function latLngOf(feature) {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Point") return { lat: g.coordinates[1], lng: g.coordinates[0] };
  try { const c = L.geoJSON(feature).getBounds().getCenter(); return { lat: c.lat, lng: c.lng }; }
  catch (e) { return null; }
}

/* ---------- 5. MAP + BASE LAYERS ---------- */
const map = L.map("map", { zoomControl: true }).setView([30.4, 69.3], 5);

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);
const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19, attribution: "Tiles &copy; Esri"
});

/* ---------- 6. OVERLAY LAYERS & TOGGLES ---------- */
const layers = {
  boundary:    L.layerGroup(),
  cities:      L.layerGroup(),
  stations:    L.layerGroup(),
  temperature: L.layerGroup(),
  rainfall:    L.layerGroup(),
  humidity:    L.layerGroup(),
  aqi:         L.layerGroup(),
  environment: L.layerGroup()
};
["boundary", "cities", "stations", "aqi"].forEach(k => layers[k].addTo(map));

L.control.layers(
  { "OpenStreetMap": osm, "Satellite Imagery": satellite },
  {
    "Pakistan Boundary": layers.boundary,
    "Cities": layers.cities,
    "Weather Stations": layers.stations,
    "Temperature": layers.temperature,
    "Rainfall": layers.rainfall,
    "Humidity": layers.humidity,
    "AQI": layers.aqi,
    "Environmental Data": layers.environment
  },
  { collapsed: window.innerWidth < 700, position: "topright" }
).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

/* ---------- 7. AQI LEGEND ---------- */
const legend = L.control({ position: "bottomright" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = "<h4>Air Quality Index (AQI)</h4>" + AQI_LEVELS.map(l =>
    `<div class="li"><span class="sw" style="background:${l.color}"></span><span>${l.label}</span><span class="rng">${l.range}</span></div>`
  ).join("");
  L.DomEvent.disableClickPropagation(div);
  return div;
};
legend.addTo(map);

/* ---------- 8. POPUPS ---------- */
function row(icon, label, valueHtml) {
  return `<div class="row"><span class="k">${icon} ${label}</span><span class="v">${valueHtml}</span></div>`;
}

function environmentPopup(rec) {
  const rows = [];
  if (rec.name !== undefined)        rows.push(row("📍", "Station", esc(rec.name)));
  if (rec.temperature !== undefined) rows.push(row("🌡", "Temperature", `${fmt(rec.temperature)} °C`));
  if (rec.rainfall !== undefined)    rows.push(row("🌧", "Rainfall", `${fmt(rec.rainfall)} mm`));
  if (rec.humidity !== undefined)    rows.push(row("💧", "Humidity", `${fmt(rec.humidity)} %`));
  if (rec.aqi !== undefined)         rows.push(row("🌫", "AQI", fmt(rec.aqi)));
  if (rec.category !== undefined) {
    const lv = levelFor(rec);
    const fg = luminanceIsLight(lv.color) ? "#1b1b1b" : "#ffffff";
    rows.push(row("📊", "Category", `<span class="pill" style="background:${lv.color};color:${fg}">${esc(rec.category)}</span>`));
  }
  return `<div class="env-popup"><div class="ph">ENVIRONMENTAL TELEMETRY</div>${rows.join("")}<div class="pb"></div></div>`;
}

function cityPopup(c) {
  const rows = [];
  if (c.name)     rows.push(row("🏙", "City", esc(c.name)));
  if (c.province) rows.push(row("🗺", "Province", esc(c.province)));
  if (c.type)     rows.push(row("🏷", "Type", esc(c.type)));
  return `<div class="env-popup"><div class="ph">CITY PROFILE</div>${rows.join("")}<div class="pb"></div></div>`;
}

/* ---------- 9. RECORD MERGING ---------- */
const merged = new Map();
function stationKey(name, ll) {
  if (name) return "n:" + normKey(name).replace(/weatherstation|monitoring|station|aqi|raingauge/g, "");
  return "c:" + ll.lat.toFixed(3) + "," + ll.lng.toFixed(3);
}
function ingest(fc) {
  const recs = [];
  if (!fc || !fc.features) return recs;
  for (const f of fc.features) {
    const ll = latLngOf(f);
    if (!ll) continue;
    const p = f.properties || {};
    const ex = {
      name: pick(p, "name"), temperature: pick(p, "temperature"), humidity: pick(p, "humidity"),
      rainfall: pick(p, "rainfall"), aqi: pick(p, "aqi"), category: pick(p, "category")
    };
    const key = stationKey(ex.name, ll);
    let rec = merged.get(key);
    if (!rec) { rec = { lat: ll.lat, lng: ll.lng }; merged.set(key, rec); }
    for (const k of Object.keys(ex)) if (rec[k] === undefined && ex[k] !== undefined) rec[k] = ex[k];
    recs.push(rec);
  }
  return recs;
}

/* ---------- 10. MARKER FACTORIES ---------- */
function pointMarker(rec, cls, size, dx, dy) {
  const icon = L.divIcon({ className: "", html: `<div class="${cls}"></div>`, iconSize: [size, size], iconAnchor: [size / 2 - dx, size / 2 - dy] });
  return L.marker([rec.lat, rec.lng], { icon }).bindPopup(() => environmentPopup(rec), { maxWidth: 280 });
}
function badgeMarker(rec, text, bg, dx, dy) {
  const fg = luminanceIsLight(bg) ? "#1b1b1b" : "#ffffff";
  const icon = L.divIcon({
    className: "",
    html: `<span class="badge" style="background:${bg};color:${fg}">${esc(text)}</span>`,
    iconSize: [34, 20], iconAnchor: [17 - dx, 10 - dy]
  });
  return L.marker([rec.lat, rec.lng], { icon }).bindPopup(() => environmentPopup(rec), { maxWidth: 280 });
}

/* ---------- 11. DATA LOADING ---------- */
async function loadGeo(key) {
  if (location.protocol === "file:" && window.__GEO && window.__GEO[key]) return window.__GEO[key];
  try {
    const r = await fetch(DATA_FILES[key], { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (window.__GEO && window.__GEO[key]) return window.__GEO[key];
    console.warn("Could not load " + DATA_FILES[key]);
    return null;
  }
}

const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
const average = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined;

(async function init() {
  const [boundary, cities, stations, rainfall, environment] =
    await Promise.all(["boundary", "cities", "stations", "rainfall", "environment"].map(loadGeo));

  if (boundary) {
    const b = L.geoJSON(boundary, { style: { color: "#f39c12", weight: 2, fillColor: "#f39c12", fillOpacity: 0.05 }, interactive: false });
    b.addTo(layers.boundary);
    map.fitBounds(b.getBounds(), { padding: [10, 10] });
  }

  const cityList = (cities && cities.features) || [];
  cityList.forEach(f => {
    const ll = latLngOf(f); if (!ll) return;
    const c = { name: pick(f.properties, "name"), province: pick(f.properties, "province"), type: pick(f.properties, "type") };
    const icon = L.divIcon({ className: "", html: '<div class="pt-city"></div>', iconSize: [12, 12] });
    L.marker([ll.lat, ll.lng], { icon }).bindPopup(cityPopup(c), { maxWidth: 260 }).addTo(layers.cities);
  });

  const stationRecs = ingest(stations);
  const envRecs     = ingest(environment);
  const rainRecs    = ingest(rainfall);

  stationRecs.forEach(r => pointMarker(r, "pt-station", 13, 0, 0).addTo(layers.stations));
  envRecs.forEach(r => pointMarker(r, "pt-env", 11, 0, -26).addTo(layers.environment));

  const all = Array.from(merged.values());
  all.forEach(r => {
    if (r.temperature !== undefined) badgeMarker(r, fmt(r.temperature) + "°", scaleColor(r.temperature, TEMP_STEPS), -24, -18).addTo(layers.temperature);
    if (r.humidity !== undefined)    badgeMarker(r, fmt(r.humidity) + "%", scaleColor(r.humidity, HUM_STEPS), 24, -18).addTo(layers.humidity);
    if (r.rainfall !== undefined)    badgeMarker(r, fmt(r.rainfall), scaleColor(r.rainfall, RAIN_STEPS), -24, 18).addTo(layers.rainfall);
    if (r.aqi !== undefined || r.category !== undefined) {
      badgeMarker(r, r.aqi !== undefined ? fmt(r.aqi) : "•", levelFor(r).color, 24, 18).addTo(layers.aqi);
    }
  });

  const temps = all.map(r => r.temperature).filter(v => v !== undefined);
  const hums  = all.map(r => r.humidity).filter(v => v !== undefined);
  const aqis  = all.map(r => r.aqi).filter(v => v !== undefined);
  setText("stat-cities", cityList.length);
  setText("stat-stations", stationRecs.length);
  setText("stat-env", envRecs.length);
  setText("stat-rain", rainRecs.filter(r => r.rainfall !== undefined).length);
  const show = (id, arr, unit) => {
    const a = average(arr);
    setText("stat-" + id, a === undefined ? "–" : fmt(a) + unit);
    setText("stat-" + id + "-sub", arr.length ? `from ${arr.length} records` : "no data");
  };
  show("temp", temps, " °C");
  show("hum", hums, " %");
  show("aqi", aqis, "");

  if ([boundary, cities, stations, rainfall, environment].some(fc => fc && fc.sample === true)) {
    document.getElementById("sampleBadge").hidden = false;
  }
})();

if (boundary) {
  const b = L.geoJSON(boundary, { style: { color: "#f39c12", weight: 2, fillColor: "#f39c12", fillOpacity: 0.05 }, interactive: false });
  b.addTo(layers.boundary);
  map.fitBounds(b.getBounds(), { padding: [10, 10] });
  setTimeout(() => map.invalidateSize(), 150);
}
