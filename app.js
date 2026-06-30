// =============================================================
//  Días de vacaciones — lógica de la app
// =============================================================

// ---- Configuración (cámbiala a tu gusto) --------------------
const CONFIG = {
  startMonth: "2026-06", // primer mes (incluido)  AAAA-MM
  endMonth:   "2026-09", // último mes (incluido)  AAAA-MM
  passphrase: ""         // opcional: pon una palabra para limitar el acceso. "" = sin clave
};

// ---- Constantes ---------------------------------------------
const NEXT = { libre: "ocupado", ocupado: "inseguro", inseguro: "libre" };
const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio",
  "Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DOW = ["L", "M", "X", "J", "V", "S", "D"];
const DOW_FULL = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

// ---- Inicializar Firebase -----------------------------------
let db = null;
let firebaseReady = false;
try {
  if (typeof firebaseConfig !== "undefined" &&
      firebaseConfig.apiKey &&
      !firebaseConfig.apiKey.includes("PEGA")) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    firebaseReady = true;
  }
} catch (e) {
  console.error("No se pudo iniciar Firebase:", e);
}

// ---- Estado -------------------------------------------------
const state = {
  uid: getUid(),
  name: localStorage.getItem("vac_name") || "",
  myDays: {},        // { "2026-07-15": "ocupado" | "inseguro" }  (libre no se guarda)
  participants: {},  // uid -> { name, dias }
  view: "mine",
  loadedMine: false
};

// ---- Utilidades ---------------------------------------------
function getUid() {
  let id = localStorage.getItem("vac_uid");
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "u" + Date.now() + Math.random().toString(16).slice(2);
    localStorage.setItem("vac_uid", id);
  }
  return id;
}
const pad = n => String(n).padStart(2, "0");
const dateStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
function firstDowMon(y, m) {           // lunes = 0 ... domingo = 6
  return (new Date(y, m - 1, 1).getDay() + 6) % 7;
}
function prettyDate(dt) {
  const [y, m, d] = dt.split("-").map(Number);
  const js = new Date(y, m - 1, d);
  return `${DOW_FULL[js.getDay()]} ${d} de ${MONTH_NAMES[m - 1].toLowerCase()}`;
}
function monthList() {
  const [sy, sm] = CONFIG.startMonth.split("-").map(Number);
  const [ey, em] = CONFIG.endMonth.split("-").map(Number);
  const out = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push({ year: y, month: m });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
function buildWeeks(y, m) {
  const total = daysInMonth(y, m);
  const lead = firstDowMon(y, m);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(dateStr(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ---- Persistencia (Firestore) -------------------------------
let saveTimer = null;
function scheduleSave() {
  if (!firebaseReady) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
async function saveNow() {
  if (!firebaseReady || !state.name) return;
  try {
    await db.collection("participants").doc(state.uid).set({
      name: state.name,
      dias: state.myDays,
      updatedAt: Date.now()
    });
  } catch (e) {
    console.error("Error guardando:", e);
    showToast("⚠️ No se pudo guardar");
  }
}
function subscribe() {
  if (!firebaseReady) return;
  db.collection("participants").onSnapshot(
    snap => {
      const p = {};
      snap.forEach(doc => { p[doc.id] = doc.data(); });
      state.participants = p;
      // En la primera carga adoptamos lo que ya teníamos guardado en el servidor
      if (!state.loadedMine) {
        if (p[state.uid] && p[state.uid].dias) state.myDays = { ...p[state.uid].dias };
        state.loadedMine = true;
      }
      render();
      // Ya tenemos la lista de participantes: si no hay nombre, mostramos la bienvenida.
      if (!welcomeShown && !state.name) { welcomeShown = true; showWelcome(); }
    },
    err => {
      console.error("Error de conexión:", err);
      showToast("⚠️ Sin conexión a la base de datos");
    }
  );
}

// ---- Acciones de edición ------------------------------------
function cycleDay(date) {
  const cur = state.myDays[date] || "libre";
  const nxt = NEXT[cur];
  if (nxt === "libre") delete state.myDays[date];
  else state.myDays[date] = nxt;
  render();
  scheduleSave();
}
function cycleWeek(dates) {
  const ref = state.myDays[dates[0]] || "libre";
  const nxt = NEXT[ref];
  dates.forEach(dt => {
    if (nxt === "libre") delete state.myDays[dt];
    else state.myDays[dt] = nxt;
  });
  render();
  scheduleSave();
}

// ---- Estadísticas de grupo ----------------------------------
function dayStats(date) {
  let busy = 0, maybe = 0, free = 0;
  const people = Object.values(state.participants);
  people.forEach(p => {
    const s = (p.dias || {})[date];
    if (s === "ocupado") busy++;
    else if (s === "inseguro") maybe++;
    else free++;
  });
  return { total: people.length, busy, maybe, free };
}

// ---- Render -------------------------------------------------
const app = document.getElementById("app");

function render() {
  // contador de participantes
  const n = Object.keys(state.participants).length;
  document.getElementById("participants-count").textContent =
    n === 1 ? "1 persona" : `${n} personas`;

  app.innerHTML = monthList()
    .map(({ year, month }) => renderMonth(year, month, state.view))
    .join("");
}

function renderMonth(y, m, mode) {
  const weeks = buildWeeks(y, m);
  const head = `<div class="wk-head"></div>` + DOW.map(d => `<div class="dow">${d}</div>`).join("");
  const body = weeks.map(week => renderWeek(week, mode)).join("");
  return `<section class="month"><h3>${MONTH_NAMES[m - 1]} ${y}</h3>
    <div class="grid">${head}${body}</div></section>`;
}

function renderWeek(week, mode) {
  const dates = week.filter(Boolean);
  let firstCol;
  if (mode === "mine") {
    firstCol = `<button class="wk-btn" data-week="${dates.join(",")}">sem</button>`;
  } else {
    firstCol = `<div class="wk-head"></div>`;
  }
  const cells = week.map(dt => {
    if (!dt) return `<div class="cell empty"></div>`;
    const dnum = Number(dt.slice(8));
    if (mode === "mine") {
      const st = state.myDays[dt] || "libre";
      return `<button class="cell ${st}" data-date="${dt}">${dnum}</button>`;
    }
    // vista grupo
    const s = dayStats(dt);
    if (s.total === 0) {
      return `<button class="cell heat nodata" data-date="${dt}"><span class="dnum">${dnum}</span></button>`;
    }
    const ratio = s.free / s.total;
    const hue = Math.round(120 * ratio);          // 0 = rojo, 120 = verde
    const cls = (s.free === s.total) ? "cell heat allfree" : "cell heat";
    return `<button class="${cls}" data-date="${dt}" style="--c:hsl(${hue},58%,45%)">
      <span class="dnum">${dnum}</span><span class="cnt">${s.free}</span></button>`;
  }).join("");
  return firstCol + cells;
}

// ---- Panel de detalle (vista grupo) -------------------------
function showDetail(date) {
  const busy = [], maybe = [], free = [];
  Object.values(state.participants).forEach(p => {
    const s = (p.dias || {})[date];
    const nm = p.name || "—";
    if (s === "ocupado") busy.push(nm);
    else if (s === "inseguro") maybe.push(nm);
    else free.push(nm);
  });
  const row = (emoji, label, names) =>
    `<div class="detail-row">
       <span class="lbl">${emoji} ${label} (${names.length})</span>
       <div class="detail-names ${names.length ? "" : "empty"}">${names.length ? names.join(", ") : "nadie"}</div>
     </div>`;

  document.getElementById("detail-content").innerHTML =
    `<h3>${prettyDate(date)}</h3>` +
    row("🟢", "Libres", free) +
    row("🔴", "Ocupados", busy) +
    row("🟡", "Inseguros", maybe);
  document.getElementById("detail").classList.remove("hidden");
}

// ---- Toast --------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2500);
}

// ---- Nombre / identidad / bienvenida ------------------------
const normName = s => (s || "").trim().toLowerCase();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Un registro por nombre (el más reciente), ordenado alfabéticamente.
function uniqueParticipantNames() {
  const byName = {};
  Object.entries(state.participants).forEach(([id, p]) => {
    const nm = (p.name || "").trim();
    if (!nm) return;
    const key = normName(nm);
    if (!byName[key] || (p.updatedAt || 0) > (byName[key].updatedAt || 0)) {
      byName[key] = { id, name: nm, updatedAt: p.updatedAt || 0 };
    }
  });
  return Object.values(byName).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function setName(name) {
  state.name = name.trim();
  localStorage.setItem("vac_name", state.name);
  document.getElementById("nameInput").value = state.name;
  scheduleSave();
}

// "Convertirse" en un participante que ya existe: carga sus días y su id.
function claimIdentity(id) {
  const p = state.participants[id];
  if (!p) return;
  state.uid = id;
  localStorage.setItem("vac_uid", id);
  state.name = (p.name || "").trim();
  localStorage.setItem("vac_name", state.name);
  state.myDays = { ...(p.dias || {}) };
  state.loadedMine = true;
  document.getElementById("nameInput").value = state.name;
  document.getElementById("name-modal").classList.add("hidden");
  render();
}

// Entrar con un nombre escrito: si ya existe, reconecta; si no, usuario nuevo.
function submitName(raw) {
  const v = (raw || "").trim();
  if (!v) return false;
  const match = uniqueParticipantNames().find(n => normName(n.name) === normName(v));
  if (match) {
    claimIdentity(match.id);
  } else {
    setName(v);
    document.getElementById("name-modal").classList.add("hidden");
  }
  return true;
}

let welcomeShown = false;
function showWelcome() {
  const modal = document.getElementById("name-modal");
  const wrap = document.getElementById("existing-wrap");
  const list = document.getElementById("existing-names");
  const cancel = document.getElementById("welcome-cancel");
  const input = document.getElementById("modalNameInput");

  const names = uniqueParticipantNames();
  if (names.length) {
    list.innerHTML = names
      .map(n => `<button class="name-chip" data-id="${n.id}">${escapeHtml(n.name)}</button>`)
      .join("");
    wrap.classList.remove("hidden");
  } else {
    wrap.classList.add("hidden");
  }

  // El botón de cancelar solo aparece si ya tenías nombre (modo "cambiar de usuario").
  cancel.classList.toggle("hidden", !state.name);
  input.value = "";
  modal.classList.remove("hidden");
}

// ---- Eventos ------------------------------------------------
function wireEvents() {
  // tocar días / semanas
  app.addEventListener("click", e => {
    const wk = e.target.closest("[data-week]");
    if (wk) {
      if (!state.name) { showWelcome(); return; }
      cycleWeek(wk.dataset.week.split(","));
      return;
    }
    const day = e.target.closest("[data-date]");
    if (!day) return;
    if (state.view === "mine") {
      if (!state.name) { showWelcome(); return; }
      cycleDay(day.dataset.date);
    } else {
      showDetail(day.dataset.date);
    }
  });

  // pestañas
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
      document.getElementById("legend-mine").classList.toggle("hidden", state.view !== "mine");
      document.getElementById("legend-group").classList.toggle("hidden", state.view !== "group");
      document.getElementById("detail").classList.add("hidden");
      render();
    });
  });

  // nombre en la cabecera
  const nameInput = document.getElementById("nameInput");
  nameInput.value = state.name;
  let nameTimer = null;
  nameInput.addEventListener("input", () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => setName(nameInput.value), 400);
  });

  // pantalla de bienvenida / cambio de usuario
  const modal = document.getElementById("name-modal");
  const modalInput = document.getElementById("modalNameInput");
  const modalBtn = document.getElementById("modalNameBtn");
  const submit = () => { if (!submitName(modalInput.value)) modalInput.focus(); };
  modalBtn.addEventListener("click", submit);
  modalInput.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });

  // tocar un nombre que ya existe
  document.getElementById("existing-names").addEventListener("click", e => {
    const chip = e.target.closest("[data-id]");
    if (chip) claimIdentity(chip.dataset.id);
  });

  // cancelar (solo disponible al cambiar de usuario)
  document.getElementById("welcome-cancel").addEventListener("click", () =>
    modal.classList.add("hidden"));

  // botón "cambiar" junto al nombre
  document.getElementById("switchUserBtn").addEventListener("click", showWelcome);

  // cerrar detalle
  document.getElementById("detail-close").addEventListener("click", () =>
    document.getElementById("detail").classList.add("hidden"));
}

// ---- Clave de acceso opcional -------------------------------
function passphraseOk() {
  if (!CONFIG.passphrase) return true;
  if (localStorage.getItem("vac_pass") === CONFIG.passphrase) return true;
  const entered = window.prompt("Introduce la clave para entrar:");
  if (entered === CONFIG.passphrase) {
    localStorage.setItem("vac_pass", entered);
    return true;
  }
  document.body.innerHTML =
    '<p style="padding:40px;text-align:center;font-family:sans-serif">🔒 Clave incorrecta. Recarga la página para intentarlo de nuevo.</p>';
  return false;
}

// ---- Arranque -----------------------------------------------
function init() {
  if (!passphraseOk()) return;
  wireEvents();
  render();
  if (!firebaseReady) {
    document.getElementById("config-warning").classList.remove("hidden");
    if (!state.name) showWelcome();
  }
  subscribe();
}
init();
