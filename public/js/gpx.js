// Conversión de la ruta de Mapit (GeoJSON) a GPX. Port del script mapit_export.py.

const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const okPt = (c) => Array.isArray(c) && c.length >= 2 && isNum(c[0]) && isNum(c[1]);

export function hav(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const la1 = a[1] * r, lo1 = a[0] * r, la2 = b[1] * r, lo2 = b[0] * r;
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function toDt(v) {
  try {
    if (isNum(v) || (typeof v === "string" && /^\d{9,13}(\.\d+)?$/.test(v))) {
      const x = Number(v);
      return new Date(x > 1e11 ? x : x * 1000);
    }
    if (typeof v === "string") {
      const d = new Date(v);
      if (!isNaN(d)) return d;
    }
  } catch { /* ignorar */ }
  return null;
}

// ------------------------------------------------------------- geometrías
export function collectFeatures(obj) {
  const feats = [];
  (function walk(n) {
    if (Array.isArray(n)) n.forEach(walk);
    else if (isObj(n)) {
      if (n.type === "Feature" && isObj(n.geometry)) feats.push([n.geometry, n.properties || {}]);
      else Object.values(n).forEach(walk);
    }
  })(obj);
  return feats;
}

export function featurePieces(obj) {
  const out = [];
  for (const [g, p] of collectFeatures(obj)) {
    const c = g.coordinates;
    const lines = g.type === "LineString" ? [c] : g.type === "MultiLineString" ? c : [];
    for (const ln of lines || []) {
      const pts = (Array.isArray(ln) ? ln : []).filter((q) => okPt(q));
      if (pts.length >= 2) out.push({ pts, inferred: !!(isObj(p) && p.inferred) });
    }
  }
  return out;
}

export function geoSegments(obj) {
  const lines = [], points = [];
  (function walk(n) {
    if (isObj(n)) {
      const c = n.coordinates;
      if (n.type === "LineString" && Array.isArray(c)) lines.push(c);
      else if (n.type === "MultiLineString" && Array.isArray(c)) lines.push(...c);
      else if (n.type === "Point" && Array.isArray(c)) points.push(c);
      Object.values(n).forEach(walk);
    } else if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === "string" && (n[0] === "{" || n[0] === "[") && n.includes("coordinates")) {
      try { walk(JSON.parse(n)); } catch { /* ignorar */ }
    }
  })(obj);
  let segs = lines.filter((s) => Array.isArray(s) && s.length >= 2);
  if (!segs.length && points.length >= 2) segs = [points];
  if (!segs.length) {
    (function walk2(n) {
      if (Array.isArray(n) && n.length >= 2 && n.every(isObj)) {
        const pts = [];
        for (const p of n) {
          const la = p.lat ?? p.latitude;
          const lo = p.lng ?? p.lon ?? p.longitude;
          if (isNum(la) && isNum(lo)) pts.push([lo, la]);
        }
        if (pts.length >= 2) { segs.push(pts); return; }
      }
      if (isObj(n)) Object.values(n).forEach(walk2);
      else if (Array.isArray(n)) n.forEach(walk2);
    })(obj);
  }
  return segs.map((s) => s.filter(okPt));
}

export function geoMarkers(obj) {
  const out = [];
  for (const [g, p] of collectFeatures(obj)) {
    const c = g.coordinates;
    if (g.type === "Point" && okPt(c) && isObj(p)) {
      const nm = p.name || p.label;
      if (nm) out.push([c[1], c[0], String(nm), String(p.label || "")]);
    }
  }
  return out;
}

export function markerPoint(obj, name) {
  for (const [lat, lon, nm] of geoMarkers(obj)) if (nm.toLowerCase() === name) return [lon, lat];
  return null;
}

// ------------------------------------------------------------------ orden
export function thirdMode(segs) {
  const vals = segs.flatMap((s) => s.filter((c) => c.length > 2 && isNum(c[2])).map((c) => c[2]));
  if (!vals.length) return null;
  const sorted = segs.every((sg) => {
    const p = sg.filter((c) => c.length > 2 && isNum(c[2])).map((c) => c[2]);
    return p.every((v, i) => i === 0 || p[i - 1] <= v);
  });
  return vals.every((v) => v > 1e9) && sorted ? "time" : null;
}

export function normalizeOrder(segs, mode) {
  if (mode !== "time") return segs;
  const key = (c) => (c.length > 2 ? c[2] : 0);
  return segs.map((sg) => [...sg].sort((a, b) => key(a) - key(b))).sort((a, b) => key(a[0]) - key(b[0]));
}

export function orderPieces(segs, start) {
  const n = segs.length;
  const order0 = [...Array(n).keys()];
  if (n < 2) return order0;
  const gaps = (o) => o.slice(1).reduce((s, b, i) => s + hav(segs[o[i]][segs[o[i]].length - 1], segs[b][0]), 0);
  let head;
  if (start) {
    head = order0.reduce((best, i) => (hav(start, segs[i][0]) < hav(start, segs[best][0]) ? i : best), 0);
  } else {
    const heads = order0.filter((i) => !order0.some((j) => j !== i && hav(segs[j][segs[j].length - 1], segs[i][0]) < 5));
    head = heads.length ? heads[0] : 0;
  }
  const chain = [head];
  const rest = new Set(order0.filter((i) => i !== head));
  while (rest.size) {
    const cur = segs[chain[chain.length - 1]];
    let best = null, bd = Infinity;
    for (const i of [...rest].sort((a, b) => a - b)) {
      const d = hav(cur[cur.length - 1], segs[i][0]);
      if (d < bd) { bd = d; best = i; }
    }
    chain.push(best);
    rest.delete(best);
  }
  return gaps(chain) < gaps(order0) - 1 ? chain : order0;
}

// ---------------------------------------------------------------- salida
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function gpxXml(name, segs, mode, markers = []) {
  const L = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="mapit-export-web" xmlns="http://www.topografix.com/GPX/1/1">',
  ];
  for (const [lat, lon, nm, lb] of markers) {
    L.push(`<wpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><name>${esc(nm)}</name>` +
      (lb ? `<desc>${esc(lb)}</desc>` : "") + "</wpt>");
  }
  L.push(`<trk><name>${esc(name)}</name>`);
  for (const s of segs) {
    L.push("<trkseg>");
    for (const c of s) {
      let t = `<trkpt lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}">`;
      if (c.length > 2 && isNum(c[2])) {
        if (mode === "ele") t += `<ele>${c[2].toFixed(1)}</ele>`;
        else if (mode === "time") {
          const dt = toDt(c[2]);
          if (dt) t += `<time>${dt.toISOString().replace(/\.\d{3}Z$/, "Z")}</time>`;
        }
      }
      L.push(t + "</trkpt>");
    }
    L.push("</trkseg>");
  }
  L.push("</trk></gpx>");
  return L.join("\n");
}

// ---------------------------------------------------------------- nombres
const START_K = ["startTime", "startedAt", "startDate", "start", "startTimestamp", "from", "date", "createdAt"];
const NAME_K = ["name", "title", "label"];

function first(dicts, keys) {
  for (const d of dicts) {
    if (!isObj(d)) continue;
    for (const k of keys) {
      let v = d[k];
      if (isObj(v)) v = v.time || v.date || v.timestamp;
      if (v !== null && v !== undefined && v !== "") return v;
    }
  }
  return null;
}

export const startOf = (item) => first([item], START_K);

const slug = (s) => String(s).replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 50);
const p2 = (n) => String(n).padStart(2, "0");

export function routeFilename(rid, item, detail) {
  const ctx = [item, detail];
  if (isObj(detail)) ctx.push(detail.route, detail.data);
  const start = toDt(first(ctx, START_K));
  const name = first(ctx, NAME_K);
  const date = start
    ? `${start.getFullYear()}-${p2(start.getMonth() + 1)}-${p2(start.getDate())}_${p2(start.getHours())}${p2(start.getMinutes())}`
    : "undated";
  const parts = [date, name ? slug(name) : null, slug(rid).slice(-8)].filter(Boolean);
  return { filename: parts.join("_") + ".gpx", title: name || (start ? date : String(rid)), start };
}

export function buildRoute(rid, item, detail) {
  let segs = featurePieces(detail).map((p) => p.pts);
  if (!segs.length) segs = geoSegments(detail);
  if (!segs.length) throw new Error("la ruta no contiene coordenadas");
  const { filename, title, start } = routeFilename(rid, item, detail);
  const mode = thirdMode(segs);
  segs = mode === "time" ? normalizeOrder(segs, mode) : orderPieces(segs, markerPoint(detail, "start")).map((i) => segs[i]);
  return {
    rid: String(rid),
    filename,
    title,
    start,
    points: segs.reduce((n, s) => n + s.length, 0),
    gpx: gpxXml(title, segs, mode, geoMarkers(detail)),
  };
}
