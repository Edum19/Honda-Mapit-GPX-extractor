// Copyright (C) 2026 Edum19
// This file is part of mapit-export-web.
// Licensed under the GNU GPL v3 or later. See LICENSE for details.
// Reenvío SIN ESTADO de peticiones GET ya firmadas hacia la API de Mapit.
// Solo se usa si el navegador no puede hablar directamente con Mapit (CORS).
//
// Garantías de diseño (verificables leyendo este archivo):
//  - No hay console.log, ni base de datos, ni caché, ni variables globales con datos.
//  - Solo reenvía a https://*.mapit.me, solo GET y solo desde esta misma web.
//  - Nunca recibe la contraseña: el navegador ya la ha usado contra Cognito.
//    Lo que pasa por aquí son credenciales temporales (caducan en ~1 h) y rutas.
//  - La URL de Mapit viaja en el cuerpo POST, no en la ruta, para no aparecer en
//    los registros de peticiones de la plataforma.
const ALLOWED_HOST = /^([a-z0-9-]+\.)+mapit\.me$/i;
const BLOCKED_HEADERS = new Set([
  "host", "connection", "content-length", "transfer-encoding", "cookie", "set-cookie",
  "upgrade", "proxy-authorization", "te", "trailer", "keep-alive", "expect", "forwarded",
  "x-forwarded-for", "x-forwarded-host", "x-real-ip", "origin", "referer",
]);
const MAX_BODY = 8 * 1024 * 1024;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  // Solo esta misma web puede usarlo (evita que sea un proxy abierto).
  try {
    const origin = req.headers.origin ? new URL(req.headers.origin).host : null;
    if (!origin || origin !== req.headers.host) {
      return res.status(403).json({ error: "Origen no permitido" });
    }
  } catch {
    return res.status(403).json({ error: "Origen no permitido" });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  let target;
  try {
    target = new URL(body && body.url);
  } catch {
    return res.status(400).json({ error: "URL no válida" });
  }
  if (target.protocol !== "https:" || target.port || target.username || target.password ||
      !ALLOWED_HOST.test(target.hostname)) {
    return res.status(400).json({ error: "Destino no permitido" });
  }

  const headers = { "User-Agent": "Mozilla/5.0 (compatible; mapit-export-web)" };
  for (const [k, v] of Object.entries((body && body.headers) || {})) {
    if (/^[A-Za-z0-9-]{1,64}$/.test(k) && !BLOCKED_HEADERS.has(k.toLowerCase()) &&
        typeof v === "string" && v.length < 8192) {
      headers[k] = v;
    }
  }

  try {
    const r = await fetch(target, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
    });
    const text = await r.text();
    if (text.length > MAX_BODY) return res.status(502).json({ error: "Respuesta demasiado grande" });
    return res.status(200).json({ status: r.status, body: text });
  } catch {
    return res.status(502).json({ error: "No se pudo contactar con Mapit" });
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
