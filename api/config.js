// Lee la configuración PÚBLICA de app.mapit.me (ids de Cognito y URLs de la API).
// No recibe ni guarda datos de usuario. No hay logs ni almacenamiento.
const APP_URL = "https://app.mapit.me/";
const NEED = ["user_pool_id", "client_id", "identity_pool_id", "core_url", "geo_url"];
const UA = "Mozilla/5.0 (compatible; mapit-export-web)";
const TTL_MS = 60 * 60 * 1000;

let cache = { cfg: null, at: 0 }; // solo en memoria de la instancia

function uniq(arr) {
  return [...new Set(arr)];
}

function parseConfig(blob) {
  const cfg = {};
  const pools = uniq(blob.match(/\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]{9}\b/g) || []);
  if (pools.length) {
    cfg.user_pool_ids = pools;
    cfg.user_pool_id = pools[0];
  }
  const ip = blob.match(
    /\b[a-z]{2}-[a-z]+-\d:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/
  );
  if (ip) cfg.identity_pool_id = ip[0];

  let cids = [];
  const re1 =
    /(?:userPoolClientId|user_pool_client_id|USER_POOL_CLIENT_ID|CLIENT_ID|clientId|ClientId)["']?\s*[:=]\s*["']([a-z0-9]{20,32})["']/g;
  for (const m of blob.matchAll(re1)) cids.push(m[1]);
  for (const p of pools) {
    let from = 0;
    for (;;) {
      const i = blob.indexOf(p, from);
      if (i < 0) break;
      from = i + p.length;
      const near = blob.slice(Math.max(0, i - 600), i + p.length + 600);
      for (const m of near.matchAll(/["']([a-z0-9]{26})["']/g)) cids.push(m[1]);
    }
  }
  cids = uniq(cids);
  if (cids.length) {
    cfg.client_ids = cids;
    cfg.client_id = cids[0];
  }

  const hn = {};
  for (const m of blob.matchAll(
    /["']([A-Za-z][A-Za-z0-9-]{0,30}[iI][dD]-?[tT]oken[A-Za-z0-9-]{0,10})["']/g
  )) {
    if (!(m[1].toLowerCase() in hn)) hn[m[1].toLowerCase()] = m[1];
  }
  const names = Object.values(hn).slice(0, 8);
  if (names.length) cfg.id_token_headers = names;

  for (const h of uniq(blob.match(/https:\/\/[a-z0-9.-]+\.mapit\.me/g) || []).sort()) {
    const host = new URL(h).hostname;
    if (host.startsWith("core") && !cfg.core_url) cfg.core_url = h;
    if (host.startsWith("geo") && !cfg.geo_url) cfg.geo_url = h;
  }
  return cfg;
}

function mergeCfg(cfg, add) {
  for (const [k, v] of Object.entries(add)) {
    if (Array.isArray(v)) cfg[k] = uniq([...(cfg[k] || []), ...v]);
    else if (!(k in cfg)) cfg[k] = v;
  }
}

async function get(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(12000),
    redirect: "follow",
  });
  if (!r.ok) return null;
  return r.text();
}

async function discover() {
  const html = await get(APP_URL);
  if (!html) throw new Error("No se pudo cargar app.mapit.me");
  const cfg = parseConfig(html);
  const queue = [...html.matchAll(/(?:src|href)=["']([^"']+\.m?js[^"']*)["']/g)].map((m) =>
    new URL(m[1], APP_URL).href
  );
  const seen = new Set();
  while (queue.length && seen.size < 60 && !NEED.every((k) => k in cfg)) {
    const wave = [];
    while (queue.length && wave.length < 6) {
      const u = queue.shift();
      if (!seen.has(u) && new URL(u).protocol === "https:") {
        seen.add(u);
        wave.push(u);
      }
    }
    const texts = await Promise.all(wave.map((u) => get(u).catch(() => null)));
    texts.forEach((txt, i) => {
      if (!txt) return;
      mergeCfg(cfg, parseConfig(txt));
      for (const m of txt.matchAll(
        /["']((?:\.\/|\/)?(?:assets|_next\/static|static)\/[\w\-./%]+\.js)["']/g
      )) {
        queue.push(new URL(m[1], wave[i]).href);
      }
    });
  }
  return cfg;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido" });
  }
  try {
    if (!cache.cfg || Date.now() - cache.at > TTL_MS) {
      cache = { cfg: await discover(), at: Date.now() };
    }
    return res.status(200).json(cache.cfg);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "No se pudo leer la configuración de Mapit" });
  }
}
