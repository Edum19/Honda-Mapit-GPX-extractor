import { Mapit, ApiError, SessionExpired, getConfig, findKey, monthWindows, listMonth, getDetail } from "./mapit.js";
import { buildRoute, startOf } from "./gpx.js";
import { makeZip } from "./zip.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = { api: null, vehicles: [], routes: new Map(), cancel: false, busy: false };

$("until").value = new Date().toISOString().slice(0, 7);

// ----------------------------------------------------------------- utilidades
function log(msg) {
  const el = $("log");
  el.textContent += msg + "\n";
  if (el.textContent.length > 30000) el.textContent = el.textContent.slice(-20000);
  el.scrollTop = el.scrollHeight;
}

function setBusy(b) {
  S.busy = b;
  for (const id of ["btn-login", "btn-export", "btn-list", "btn-logout", "btn-zip"]) $(id).disabled = b;
  $("btn-stop").hidden = !b || $("step-export").hidden;
}

function showError(el, msg) {
  el.textContent = msg || "";
  el.hidden = !msg;
}

function setMode(m) {
  const el = $("conn");
  el.hidden = false;
  el.textContent = m === "direct"
    ? "Conexión: directa entre tu navegador y Mapit."
    : "Conexión: las peticiones pasan por la función sin estado de esta web (Mapit bloquea el acceso directo).";
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function overrides() {
  const o = {};
  document.querySelectorAll("[data-ov]").forEach((i) => { if (i.value.trim()) o[i.dataset.ov] = i.value.trim(); });
  return o;
}

const vehicleLabel = (v) => String(v.name || v.alias || v.id);

function updateCount() {
  $("step-results").hidden = S.routes.size === 0;
  $("count").textContent = String(S.routes.size);
}

function addRow(r) {
  const li = document.createElement("li");
  const f = document.createElement("span");
  f.className = "f mono";
  f.textContent = r.filename;
  const n = document.createElement("span");
  n.className = "n mono";
  n.textContent = `${r.points} pts`;
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "Descargar";
  b.dataset.rid = r.rid;
  b.setAttribute("aria-label", "Descargar " + r.filename);
  li.append(f, n, b);
  $("routes").appendChild(li);
  updateCount();
}

// ---------------------------------------------------------------------- login
$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (S.busy) return;
  const email = $("email").value.trim();
  let pw = $("password").value;
  $("password").value = ""; // la contraseña no se queda en el formulario
  showError($("login-err"), "");
  if (!email || !pw) return showError($("login-err"), "Escribe el correo y la contraseña.");
  setBusy(true);
  try {
    if (!S.api) {
      const cfg = await getConfig(overrides());
      S.api = new Mapit(cfg);
      S.api.onMode = setMode;
    }
    await S.api.login(email, pw);
    pw = null;
    const summary = await S.api.get(S.api.core, "/v1/account-summary");
    S.vehicles = (findKey(summary, "vehicles") || []).filter((v) => v && typeof v === "object" && v.id);
    if (!S.vehicles.length) throw new Error("La cuenta no tiene ninguna moto registrada.");
    const sel = $("vehicle");
    sel.replaceChildren();
    const all = new Option("Todas", "all");
    sel.add(all);
    for (const v of S.vehicles) sel.add(new Option(vehicleLabel(v), String(v.id)));
    $("step-login").hidden = true;
    $("step-export").hidden = false;
    log("Sesión iniciada. La contraseña ya se ha descartado.");
  } catch (err) {
    showError($("login-err"), err.message || String(err));
  } finally {
    pw = null;
    setBusy(false);
  }
});

// ------------------------------------------------------------------ exportar
async function run(listOnly) {
  if (S.busy) return;
  const since = $("since").value, until = $("until").value;
  if (!/^\d{4}-\d{2}$/.test(since) || !/^\d{4}-\d{2}$/.test(until) || since > until) {
    return log("Revisa las fechas: «Desde» debe ser anterior o igual a «Hasta».");
  }
  const limit = parseInt($("limit").value, 10) || 0;
  const sel = $("vehicle").value;
  const vehicles = sel === "all" ? S.vehicles : S.vehicles.filter((v) => String(v.id) === sel);
  S.cancel = false;
  setBusy(true);
  let done = 0, skipped = 0, failed = 0, listed = 0;
  const progress = () => { $("progress").textContent = `Exportadas ${done} · Omitidas ${skipped} · Fallos ${failed}`; };
  progress();
  try {
    outer:
    for (const v of vehicles) {
      log(`Moto ${vehicleLabel(v)}`);
      for (const [a, b] of monthWindows(since, until)) {
        if (S.cancel) break outer;
        const items = await listMonth(S.api, v.id, a, b);
        if (!items.length) continue;
        log(`  ${a.toISOString().slice(0, 7)}: ${items.length} rutas`);
        for (const it of items) {
          if (S.cancel) break outer;
          const rid = it.id || it.routeId;
          if (!rid) continue;
          listed++;
          if (limit && (listOnly ? listed > limit : done + skipped >= limit)) break outer;
          if (listOnly) { log(`    ${startOf(it) || "sin fecha"}`); continue; }
          if (S.routes.has(String(rid))) { skipped++; progress(); continue; }
          try {
            const r = buildRoute(rid, it, await getDetail(S.api, v.id, rid));
            S.routes.set(r.rid, r);
            addRow(r);
            done++;
            log(`    guardada ${r.filename} (${r.points} pts)`);
          } catch (err) {
            if (err instanceof SessionExpired) throw err;
            failed++;
            log(`    ! ${err.message}`);
          }
          progress();
          await sleep(200);
        }
      }
    }
    log(listOnly ? `\nRutas encontradas: ${listed}` : `\nHecho. exportadas=${done} omitidas=${skipped} fallos=${failed}`);
    if (S.cancel) log("Detenido por el usuario.");
  } catch (err) {
    if (err instanceof SessionExpired) {
      log("\nLa sesión de Mapit ha caducado (dura aproximadamente una hora). Conecta de nuevo y pulsa Exportar: continuará sin repetir lo ya guardado.");
      $("step-login").hidden = false;
      $("step-export").hidden = true;
      $("step-results").hidden = S.routes.size === 0;
    } else {
      log(`\nError: ${err.message || err}`);
    }
  } finally {
    setBusy(false);
    $("btn-stop").hidden = true;
  }
}

$("btn-export").addEventListener("click", () => run(false));
$("btn-list").addEventListener("click", () => run(true));
$("btn-stop").addEventListener("click", () => { S.cancel = true; });

// ---------------------------------------------------------------- descargas
$("routes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-rid]");
  const r = b && S.routes.get(b.dataset.rid);
  if (r) download(new Blob([r.gpx], { type: "application/gpx+xml" }), r.filename);
});

$("btn-zip").addEventListener("click", () => {
  const files = [...S.routes.values()].map((r) => ({ name: r.filename, data: r.gpx, date: r.start || new Date() }));
  if (!files.length) return;
  download(makeZip(files), `mapit-rutas-${new Date().toISOString().slice(0, 10)}.zip`);
});

$("btn-logout").addEventListener("click", () => {
  if (S.routes.size && !confirm("Se borrarán de la memoria las rutas que no hayas descargado. ¿Continuar?")) return;
  S.api = null;
  S.vehicles = [];
  S.routes.clear();
  $("routes").replaceChildren();
  $("log").textContent = "";
  $("progress").textContent = "";
  $("conn").hidden = true;
  $("step-export").hidden = true;
  $("step-results").hidden = true;
  $("step-login").hidden = false;
});

window.addEventListener("beforeunload", (e) => {
  if (S.routes.size) { e.preventDefault(); e.returnValue = ""; }
});
