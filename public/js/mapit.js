// Copyright (C) 2026 Edum19
// This file is part of mapit-export-web.
// Licensed under the GNU GPL v3 or later. See LICENSE for details.
// Cliente de Mapit que corre en tu navegador.
// La contraseña solo se usa dentro de login() y no se guarda en ningún objeto.

export class ApiError extends Error {
  constructor(status, msg) {
    super(`HTTP ${status}: ${msg}`);
    this.status = status;
  }
}
export class SessionExpired extends Error {
  constructor() {
    super("La sesión de Mapit ha caducado");
  }
}

const NEED = ["user_pool_id", "client_id", "identity_pool_id", "core_url", "geo_url"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- configuración
export async function getConfig(overrides = {}) {
  const cfg = {};
  const manual = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v));
  if (!NEED.every((k) => manual[k])) {
    const r = await fetch("/api/config", { credentials: "omit" });
    if (!r.ok) throw new Error("No se pudo obtener la configuración pública de Mapit.");
    Object.assign(cfg, await r.json());
  }
  Object.assign(cfg, manual);
  if (manual.client_id) cfg.client_ids = [manual.client_id];
  const missing = NEED.filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error("Falta en la configuración: " + missing.join(", ") + ". Rellénalo en Ajustes avanzados.");
  }
  return cfg;
}

// --------------------------------------------------------------- AWS / login
async function awsJson(host, target, payload) {
  const r = await fetch(`https://${host}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": target },
    body: JSON.stringify(payload),
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.message || j.__type || "error");
  return j;
}

function friendlyLoginError(e) {
  const t = String(e.message || e);
  if (t.includes("Incorrect username or password")) {
    return "Mapit reconoce el usuario pero rechaza la contraseña. Compruébala en https://app.mapit.me/. " +
      "Si entras con Google o Apple no tienes contraseña: crea una con «Olvidé mi contraseña». " +
      "Varios intentos fallidos bloquean la cuenta unos minutos.";
  }
  if (t.includes("Password attempts exceeded")) return "Demasiados intentos fallidos. Espera 15-30 minutos.";
  if (t.toLowerCase().includes("not confirmed")) return "Cuenta sin confirmar: confirma el correo que envió Mapit.";
  if (t.includes("PasswordResetRequired") || t.toLowerCase().includes("reset")) {
    return "Mapit exige restablecer la contraseña. Hazlo en https://app.mapit.me/ y vuelve a intentarlo.";
  }
  return t;
}

async function login(cfg, email, password) {
  const region = cfg.user_pool_id.split("_")[0];
  const tried = [];
  let r = null;
  for (const cid of cfg.client_ids || [cfg.client_id]) {
    try {
      r = await awsJson(`cognito-idp.${region}.amazonaws.com`, "AWSCognitoIdentityProviderService.InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: cid,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
      cfg.client_id = cid;
      break;
    } catch (e) {
      if (!(e instanceof ApiError)) throw new Error("No se pudo contactar con el servicio de acceso de Mapit (Cognito).");
      tried.push(String(e.message));
      if (!["does not exist", "ResourceNotFound", "client", "Client"].some((t) => String(e.message).includes(t))) {
        throw new Error(friendlyLoginError(e));
      }
    }
  }
  if (!r) throw new Error("Falló el acceso con todos los client id de la app. Revisa el correo/usuario o indica el client id en Ajustes avanzados.");
  if (!r.AuthenticationResult) throw new Error(`El acceso requiere un paso extra (${r.ChallengeName}) que esta herramienta no soporta.`);

  const idToken = r.AuthenticationResult.IdToken;
  const logins = { [`cognito-idp.${region}.amazonaws.com/${cfg.user_pool_id}`]: idToken };
  const iregion = cfg.identity_pool_id.split(":")[0];
  const host = `cognito-identity.${iregion}.amazonaws.com`;
  const gid = await awsJson(host, "AWSCognitoIdentityService.GetId", { IdentityPoolId: cfg.identity_pool_id, Logins: logins });
  const c = (await awsJson(host, "AWSCognitoIdentityService.GetCredentialsForIdentity", {
    IdentityId: gid.IdentityId,
    Logins: logins,
  })).Credentials;
  return { ak: c.AccessKeyId, sk: c.SecretKey, token: c.SessionToken, exp: Number(c.Expiration), region: iregion, idToken };
}

// -------------------------------------------------------------------- SigV4
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const awsEnc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const cmp = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

export function encQuery(params) {
  return Object.entries(params || {}).map(([k, v]) => [awsEnc(String(k)), awsEnc(String(v))]).sort(cmp)
    .map(([k, v]) => `${k}=${v}`).join("&");
}

export async function sigv4Headers(method, url, ak, sk, token, region, service, amzDate) {
  const u = new URL(url);
  const now = amzDate || new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const canonUri = (u.pathname || "/").split("/").map(awsEnc).join("/");
  const canonQ = u.search.slice(1).split("&").filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return [awsEnc(decodeURIComponent(i < 0 ? p : p.slice(0, i))), awsEnc(i < 0 ? "" : decodeURIComponent(p.slice(i + 1)))];
  }).sort(cmp).map(([k, v]) => `${k}=${v}`).join("&");
  const hdrs = { host: u.host, "x-amz-date": now };
  if (token) hdrs["x-amz-security-token"] = token;
  const keys = Object.keys(hdrs).sort();
  const signed = keys.join(";");
  const canonH = keys.map((k) => `${k}:${hdrs[k]}\n`).join("");
  const creq = [method, canonUri, canonQ, canonH, signed, await sha256("")].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", now, scope, await sha256(creq)].join("\n");
  let k = await hmac("AWS4" + sk, day);
  k = await hmac(k, region);
  k = await hmac(k, service);
  k = await hmac(k, "aws4_request");
  const sig = hex(await hmac(k, sts));
  const out = {
    "x-amz-date": now,
    Authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed}, Signature=${sig}`,
  };
  if (token) out["x-amz-security-token"] = token;
  return out;
}

// ------------------------------------------------------------------- cliente
export class Mapit {
  constructor(cfg) {
    this.cfg = cfg;
    this.core = cfg.core_url.replace(/\/$/, "");
    this.geo = cfg.geo_url.replace(/\/$/, "");
    this.detailOrder = [this.geo, this.core];
    this.dateFmt = ["iso", "ms"];
    this.creds = null;
    this.useProxy = false;
    this.onMode = null;
    this.modeSeen = false;
    const names = ["IdToken", "x-id-token", "Id-Token", "idtoken", ...(cfg.id_token_headers || [])];
    const seen = new Set();
    this.variants = [];
    for (const n of names) {
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        this.variants.push(["sig", n]);
      }
    }
    this.variants.push(["bearer", "Authorization"], ["raw", "Authorization"]);
  }

  async login(email, password) {
    this.creds = await login(this.cfg, email, password);
  }

  secondsLeft() {
    return this.creds ? this.creds.exp - Date.now() / 1000 : 0;
  }

  ensure() {
    if (this.secondsLeft() < 120) throw new SessionExpired();
  }

  async http(url, headers) {
    if (!this.useProxy) {
      try {
        const r = await fetch(url, { headers, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
        const out = { status: r.status, body: await r.text() };
        if (!this.modeSeen) {
          this.modeSeen = true;
          this.onMode && this.onMode("direct");
        }
        return out;
      } catch (e) {
        if (!(e instanceof TypeError)) throw e;
        this.useProxy = true; // el navegador no puede hablar directo con Mapit (CORS)
        this.modeSeen = true;
        this.onMode && this.onMode("proxy");
      }
    }
    const r = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, headers }),
      credentials: "omit",
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, j.error || "error del reenvío");
    return j;
  }

  async send(url, [kind, name]) {
    const c = this.creds;
    const hdr = { Accept: "application/json" };
    if (kind === "sig") {
      Object.assign(hdr, await sigv4Headers("GET", url, c.ak, c.sk, c.token, c.region, "execute-api"));
      hdr[name] = c.idToken;
    } else if (kind === "bearer") {
      hdr.Authorization = "Bearer " + c.idToken;
    } else {
      hdr.Authorization = c.idToken;
    }
    return this.http(url, hdr);
  }

  async get(base, path, params) {
    const url = base + path + (params ? "?" + encQuery(params) : "");
    let st = 0, data = "", last = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      this.ensure();
      let accepted = null;
      for (const v of [...this.variants]) {
        ({ status: st, body: data } = await this.send(url, v));
        if (st !== 401) {
          accepted = v;
          break;
        }
        last = data;
      }
      if (!accepted) {
        if (this.secondsLeft() < 300) throw new SessionExpired();
        throw new ApiError(401, last.slice(0, 300));
      }
      if (st < 400 && accepted !== this.variants[0]) {
        this.variants = [accepted, ...this.variants.filter((x) => x !== accepted)];
      }
      if (st === 429 || st >= 500) {
        await sleep(Math.min(2 ** attempt, 8) * 1000);
        continue;
      }
      if (st === 403 && this.secondsLeft() < 300) throw new SessionExpired();
      if (st >= 400) throw new ApiError(st, data.slice(0, 300));
      return JSON.parse(data);
    }
    throw new ApiError(st, "demasiados reintentos");
  }
}

// ------------------------------------------------------------ ayudas de API
export function asList(resp) {
  if (Array.isArray(resp)) return resp;
  if (resp && typeof resp === "object") {
    for (const k of ["data", "routes", "items", "results"]) if (Array.isArray(resp[k])) return resp[k];
  }
  return [];
}

export function findKey(node, key) {
  if (Array.isArray(node)) {
    for (const v of node) {
      const r = findKey(v, key);
      if (r != null) return r;
    }
  } else if (node && typeof node === "object") {
    if (Array.isArray(node[key])) return node[key];
    for (const v of Object.values(node)) {
      const r = findKey(v, key);
      if (r != null) return r;
    }
  }
  return null;
}

export function monthWindows(since, until) {
  let [y, m] = since.split("-").map(Number);
  const [uy, um] = until.split("-").map(Number);
  const out = [];
  while (y < uy || (y === uy && m <= um)) {
    out.push([new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1))]);
    if (m === 12) { y++; m = 1; } else m++;
  }
  return out.reverse(); // la más reciente primero
}

const fmtTime = (d, kind) => (kind === "iso" ? d.toISOString() : String(d.getTime()));

export async function listMonth(api, vid, a, b) {
  let lastErr = null;
  for (const kind of [...api.dateFmt]) {
    let params = { vehicleId: vid, from: fmtTime(a, kind), to: fmtTime(b, kind) };
    const items = [];
    let pages = 0;
    try {
      for (;;) {
        const resp = await api.get(api.geo, "/v1/routes", params);
        items.push(...asList(resp));
        const key = resp && !Array.isArray(resp) ? resp.lastEvaluatedKey : null;
        pages++;
        if (!key || pages > 50) break;
        params = { ...params, lastEvaluatedKey: typeof key === "string" ? key : JSON.stringify(key) };
      }
      api.dateFmt = [kind, ...api.dateFmt.filter((k) => k !== kind)];
      return items;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof ApiError) || e.status !== 400) throw e;
    }
  }
  throw lastErr;
}

export async function getDetail(api, vid, rid) {
  const path = `/v1/vehicles/${encodeURIComponent(String(vid))}/routes/${encodeURIComponent(String(rid))}`;
  let err = null;
  for (const base of [...api.detailOrder]) {
    try {
      const d = await api.get(base, path, { includeStats: "true" });
      api.detailOrder = [base, ...api.detailOrder.filter((b) => b !== base)];
      return d;
    } catch (e) {
      err = e;
      if (!(e instanceof ApiError) || ![403, 404].includes(e.status)) throw e;
    }
  }
  throw err;
}
