// =============================================================
//  Vacaciones en grupo — Fase 2: grupos + calendario por grupo
//  (login Google/email de la Fase 1 + grupos, base Libre/Ocupado,
//   resumen del grupo e invitación por enlace)
// =============================================================

// ---- Inicializar Firebase -----------------------------------
let auth = null, db = null, firebaseReady = false;
try {
  if (typeof firebaseConfig !== "undefined" &&
      firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("PEGA")) {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    firebaseReady = true;
  }
} catch (e) { console.error("No se pudo iniciar Firebase:", e); }

const $ = id => document.getElementById(id);

// ---- Constantes ---------------------------------------------
const NEXT = { libre: "ocupado", ocupado: "inseguro", inseguro: "libre" };
const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio",
  "Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DOW = ["L", "M", "X", "J", "V", "S", "D"];
const DOW_FULL = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

// ---- Estado -------------------------------------------------
const state = {
  profile: null,        // { displayName, email, ... }
  view: "login",
  groupsUnsub: null,
  groups: [],           // grupos a los que pertenezco
  g: null,              // contexto del grupo abierto
};

// ---- Utilidades ---------------------------------------------
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");
const pad = n => String(n).padStart(2, "0");
const initial = name => ((name || "?").trim().charAt(0).toUpperCase() || "?");
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastTimer = null;
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 2800);
}

// fechas
const dateStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const firstDowMon = (y, m) => (new Date(y, m - 1, 1).getDay() + 6) % 7;
function prettyDate(dt) {
  const [y, m, d] = dt.split("-").map(Number);
  return `${DOW_FULL[new Date(y, m - 1, d).getDay()]} ${d} de ${MONTH_NAMES[m - 1].toLowerCase()}`;
}
function monthList(startMonth, endMonth) {
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  const out = [];
  let y = sy, m = sm, guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 60) {
    out.push({ year: y, month: m });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
function buildWeeks(y, m) {
  const total = daysInMonth(y, m), lead = firstDowMon(y, m), cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(dateStr(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
function monthRangeLabel(s, e) {
  if (!s || !e) return "";
  const [sy, sm] = s.split("-").map(Number), [ey, em] = e.split("-").map(Number);
  const short = m => MONTH_NAMES[m - 1].slice(0, 3).toLowerCase();
  return sy === ey ? `${short(sm)}–${short(em)} ${sy}` : `${short(sm)} ${sy} – ${short(em)} ${ey}`;
}
function defaultMonths() {
  const d = new Date();
  const e = new Date(d.getFullYear(), d.getMonth() + 3, 1);
  return {
    start: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
    end: `${e.getFullYear()}-${pad(e.getMonth() + 1)}`,
  };
}

// ---- Vistas -------------------------------------------------
function setView(v) {
  state.view = v;
  hide($("loading-view"));
  $("login-view").classList.toggle("hidden", v !== "login");
  $("topbar").classList.toggle("hidden", v === "login");
  $("home-view").classList.toggle("hidden", v !== "home");
  $("group-view").classList.toggle("hidden", v !== "group");
}
function showLogin() { cleanupAll(); setView("login"); }

// ---- Perfil -------------------------------------------------
async function ensureProfile(user) {
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();
  if (snap.exists) { state.profile = snap.data(); return; }
  let name = (user.displayName || "").trim();
  if (!name) name = (window.prompt("¿Cómo te llamas? (lo verá tu grupo)") || "").trim();
  if (!name) name = (user.email || "Usuario").split("@")[0];
  state.profile = { displayName: name, email: user.email || "", photoURL: user.photoURL || "", createdAt: Date.now() };
  await ref.set(state.profile);
}
async function saveProfileName(newName) {
  const name = (newName || "").trim();
  if (!name) return;
  await db.collection("users").doc(auth.currentUser.uid).set({ displayName: name }, { merge: true });
  state.profile.displayName = name;
  paintUser();
  showToast("✅ Perfil actualizado");
}
function paintUser() {
  const name = state.profile.displayName || "Usuario";
  $("user-avatar").textContent = initial(name);
  $("dd-name").textContent = name;
  $("dd-email").textContent = state.profile.email || "";
}

// ---- Limpieza de suscripciones ------------------------------
function cleanupGroup() {
  if (state.g) {
    state.g.unsubGroup && state.g.unsubGroup();
    state.g.unsubMembers && state.g.unsubMembers();
    state.g = null;
  }
}
function cleanupAll() {
  if (state.groupsUnsub) { state.groupsUnsub(); state.groupsUnsub = null; }
  cleanupGroup();
  state.groups = [];
}

// ---- Router -------------------------------------------------
function router() {
  if (!auth.currentUser) { showLogin(); return; }
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("g/")) openGroup(h.slice(2));
  else if (h.startsWith("join/")) showJoin(h.slice(5));
  else showHome();
}

// ---- Home: lista de grupos ----------------------------------
function subscribeGroups() {
  if (state.groupsUnsub || !auth.currentUser) return;
  state.groupsUnsub = db.collection("groups")
    .where("memberUids", "array-contains", auth.currentUser.uid)
    .onSnapshot(snap => {
      state.groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      state.groups.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (state.view === "home") renderGroups();
    }, err => { console.error(err); showToast("⚠️ Error cargando grupos"); });
}
function showHome() {
  cleanupGroup();
  setView("home");
  subscribeGroups();
  renderGroups();
}
function renderGroups() {
  const list = $("groups-list"), empty = $("groups-empty");
  if (!state.groups.length) { list.innerHTML = ""; show(empty); return; }
  hide(empty);
  list.innerHTML = state.groups.map(g => {
    const n = (g.memberUids || []).length;
    return `<button class="group-card" data-gid="${g.id}">
      <div class="gc-name">${escapeHtml(g.name || "Grupo")}</div>
      <div class="gc-meta">👥 ${n} ${n === 1 ? "persona" : "personas"} · 📅 ${monthRangeLabel(g.startMonth, g.endMonth)}</div>
    </button>`;
  }).join("");
}

// ---- Crear grupo --------------------------------------------
function openCreateModal() {
  $("user-dropdown").classList.add("hidden");
  $("cg-name").value = "";
  const dm = defaultMonths();
  $("cg-start").value = dm.start;
  $("cg-end").value = dm.end;
  $("cg-msg").textContent = "";
  show($("create-modal"));
  $("cg-name").focus();
}
async function createGroup() {
  const name = $("cg-name").value.trim();
  const start = $("cg-start").value, end = $("cg-end").value;
  if (!name) { $("cg-msg").textContent = "Pon un nombre al grupo."; return; }
  if (!start || !end || start > end) { $("cg-msg").textContent = "Revisa los meses (desde ≤ hasta)."; return; }
  const uid = auth.currentUser.uid;
  const ref = db.collection("groups").doc();
  const code = Math.random().toString(36).slice(2, 8);
  try {
    await ref.set({ name, ownerUid: uid, memberUids: [uid], startMonth: start, endMonth: end, inviteCode: code, createdAt: Date.now() });
    await ref.collection("members").doc(uid).set({ displayName: state.profile.displayName, baseline: "libre", dias: {}, joinedAt: Date.now() });
    await db.collection("groupInvites").doc(ref.id).set({ name });
    hide($("create-modal"));
    location.hash = "#/g/" + ref.id;
  } catch (e) { console.error(e); $("cg-msg").textContent = "⚠️ " + e.message; }
}

// ---- Unirse a un grupo --------------------------------------
async function showJoin(gid) {
  if (state.groups.some(g => g.id === gid)) { location.hash = "#/g/" + gid; return; }
  cleanupGroup();
  setView("home");
  subscribeGroups();
  renderGroups();
  let name = "este grupo";
  try {
    const s = await db.collection("groupInvites").doc(gid).get();
    if (s.exists && s.data().name) name = s.data().name;
  } catch (e) { console.error(e); }
  $("join-text").textContent = `Te han invitado a "${name}". ¿Quieres unirte?`;
  $("join-modal").dataset.gid = gid;
  show($("join-modal"));
}
async function joinGroup() {
  const gid = $("join-modal").dataset.gid;
  if (!gid) return;
  const uid = auth.currentUser.uid;
  try {
    await db.collection("groups").doc(gid).update({
      memberUids: firebase.firestore.FieldValue.arrayUnion(uid),
    });
    await db.collection("groups").doc(gid).collection("members").doc(uid).set(
      { displayName: state.profile.displayName, baseline: "libre", dias: {}, joinedAt: Date.now() },
      { merge: true }
    );
    hide($("join-modal"));
    location.hash = "#/g/" + gid;
  } catch (e) { console.error(e); showToast("⚠️ No se pudo unir: " + e.message); }
}

// ---- Grupo: abrir y suscribir -------------------------------
function openGroup(gid) {
  if (state.g && state.g.id === gid) { setView("group"); return; }
  cleanupGroup();
  const g = { id: gid, data: null, members: {}, loadedMine: false, baseline: "libre", myDays: {}, tab: "mine" };
  state.g = g;
  setView("group");
  $("calendar").innerHTML = '<div class="center-pad"><div class="spinner"></div></div>';

  g.unsubGroup = db.collection("groups").doc(gid).onSnapshot(snap => {
    if (!snap.exists) { showToast("Grupo no encontrado"); location.hash = "#/"; return; }
    g.data = snap.data();
    if (!(g.data.memberUids || []).includes(auth.currentUser.uid)) { location.hash = "#/join/" + gid; return; }
    renderGroup();
  }, err => {
    console.error(err);
    if (err.code === "permission-denied") location.hash = "#/join/" + gid;
    else { showToast("⚠️ No se pudo abrir el grupo"); location.hash = "#/"; }
  });

  g.unsubMembers = db.collection("groups").doc(gid).collection("members").onSnapshot(snap => {
    const m = {};
    snap.forEach(d => { m[d.id] = d.data(); });
    g.members = m;
    if (!g.loadedMine) {
      const mine = m[auth.currentUser.uid];
      if (mine) { g.baseline = mine.baseline || "libre"; g.myDays = { ...(mine.dias || {}) }; }
      g.loadedMine = true;
      ensureMyMemberName();
    }
    renderGroup();
  }, err => console.error(err));
}
function ensureMyMemberName() {
  const g = state.g, uid = auth.currentUser.uid;
  const mine = g.members[uid];
  if (mine && mine.displayName !== state.profile.displayName) {
    db.collection("groups").doc(g.id).collection("members").doc(uid)
      .set({ displayName: state.profile.displayName }, { merge: true }).catch(() => {});
  }
}

// ---- Guardar mi disponibilidad ------------------------------
let saveTimer = null;
function scheduleSaveMember() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMemberNow, 500);
}
async function saveMemberNow() {
  const g = state.g;
  if (!g || !auth.currentUser) return;
  try {
    await db.collection("groups").doc(g.id).collection("members").doc(auth.currentUser.uid).set({
      displayName: state.profile.displayName,
      baseline: g.baseline,
      dias: g.myDays,
    }, { merge: true });
  } catch (e) { console.error(e); showToast("⚠️ No se pudo guardar"); }
}

// ---- Disponibilidad efectiva (base + excepciones) -----------
function effState(member, day) {
  return (member.dias && member.dias[day]) || member.baseline || "libre";
}
function effectiveMembers() {
  const g = state.g, out = {};
  Object.entries(g.members).forEach(([uid, m]) => { out[uid] = m; });
  const uid = auth.currentUser.uid;
  out[uid] = { ...(out[uid] || {}), displayName: state.profile.displayName, baseline: g.baseline, dias: g.myDays };
  return out;
}
function dayStats(day) {
  const members = Object.values(effectiveMembers());
  let busy = 0, maybe = 0, free = 0;
  members.forEach(m => {
    const s = effState(m, day);
    if (s === "ocupado") busy++;
    else if (s === "inseguro") maybe++;
    else free++;
  });
  return { total: members.length, busy, maybe, free };
}

// ---- Edición ------------------------------------------------
function cycleDay(date) {
  const g = state.g;
  const cur = g.myDays[date] || g.baseline;
  const nxt = NEXT[cur];
  if (nxt === g.baseline) delete g.myDays[date];
  else g.myDays[date] = nxt;
  renderGroup();
  scheduleSaveMember();
}
function cycleWeek(dates) {
  const g = state.g;
  const ref = g.myDays[dates[0]] || g.baseline;
  const nxt = NEXT[ref];
  dates.forEach(dt => {
    if (nxt === g.baseline) delete g.myDays[dt];
    else g.myDays[dt] = nxt;
  });
  renderGroup();
  scheduleSaveMember();
}
function setBaseline(b) {
  const g = state.g;
  if (g.baseline === b) return;
  g.baseline = b;
  Object.keys(g.myDays).forEach(d => { if (g.myDays[d] === b) delete g.myDays[d]; });
  renderGroup();
  scheduleSaveMember();
}

// ---- Render del grupo ---------------------------------------
function renderGroup() {
  const g = state.g;
  if (!g || !g.data) return;
  $("group-name").textContent = g.data.name || "Grupo";
  const n = Object.keys(g.members).length || (g.data.memberUids || []).length;
  $("group-sub").textContent = `👥 ${n} ${n === 1 ? "persona" : "personas"} · 📅 ${monthRangeLabel(g.data.startMonth, g.data.endMonth)}`;

  document.querySelectorAll("[data-gtab]").forEach(x => x.classList.toggle("active", x.dataset.gtab === g.tab));
  document.querySelectorAll("[data-base]").forEach(b => b.classList.toggle("active", b.dataset.base === g.baseline));
  $("baseline-bar").classList.toggle("hidden", g.tab !== "mine");
  $("legend-mine").classList.toggle("hidden", g.tab !== "mine");
  $("legend-summary").classList.toggle("hidden", g.tab !== "summary");
  hide($("gdetail"));

  $("calendar").innerHTML = monthList(g.data.startMonth, g.data.endMonth)
    .map(({ year, month }) => renderMonth(year, month, g.tab)).join("");
}
function renderMonth(y, m, mode) {
  const weeks = buildWeeks(y, m);
  const head = `<div class="wk-head"></div>` + DOW.map(d => `<div class="dow">${d}</div>`).join("");
  const body = weeks.map(week => renderWeek(week, mode)).join("");
  return `<section class="month"><h3>${MONTH_NAMES[m - 1]} ${y}</h3><div class="grid">${head}${body}</div></section>`;
}
function renderWeek(week, mode) {
  const g = state.g;
  const dates = week.filter(Boolean);
  const firstCol = mode === "mine"
    ? `<button class="wk-btn" data-week="${dates.join(",")}">sem</button>`
    : `<div class="wk-head"></div>`;
  const cells = week.map(dt => {
    if (!dt) return `<div class="cell empty"></div>`;
    const dnum = Number(dt.slice(8));
    if (mode === "mine") {
      const st = g.myDays[dt] || g.baseline;
      return `<button class="cell ${st}" data-date="${dt}">${dnum}</button>`;
    }
    const s = dayStats(dt);
    if (s.total === 0) return `<button class="cell heat nodata" data-date="${dt}"><span class="dnum">${dnum}</span></button>`;
    const hue = Math.round(120 * (s.free / s.total));
    const cls = s.free === s.total ? "cell heat allfree" : "cell heat";
    return `<button class="${cls}" data-date="${dt}" style="--c:hsl(${hue},58%,45%)"><span class="dnum">${dnum}</span><span class="cnt">${s.free}</span></button>`;
  }).join("");
  return firstCol + cells;
}
function showGDetail(date) {
  const busy = [], maybe = [], free = [];
  Object.values(effectiveMembers()).forEach(m => {
    const nm = m.displayName || "—";
    const s = effState(m, date);
    if (s === "ocupado") busy.push(nm);
    else if (s === "inseguro") maybe.push(nm);
    else free.push(nm);
  });
  const row = (emoji, label, names) =>
    `<div class="detail-row"><span class="lbl">${emoji} ${label} (${names.length})</span>
       <div class="detail-names ${names.length ? "" : "empty"}">${names.length ? names.map(escapeHtml).join(", ") : "nadie"}</div></div>`;
  $("gdetail-content").innerHTML = `<h3>${prettyDate(date)}</h3>` +
    row("🟢", "Libres", free) + row("🔴", "Ocupados", busy) + row("🟡", "Inseguros", maybe);
  show($("gdetail"));
}

// ---- Compartir / invitar ------------------------------------
function inviteLink() {
  return location.origin + location.pathname + "#/join/" + state.g.id;
}
function openShare() {
  if (!state.g) return;
  $("share-link").value = inviteLink();
  show($("share-modal"));
}

// ---- Flujo de email link (Fase 1) ---------------------------
async function completeEmailLinkIfPresent() {
  if (!firebaseReady || !auth.isSignInWithEmailLink(window.location.href)) return;
  let email = localStorage.getItem("emailForSignIn");
  if (!email) email = window.prompt("Confirma tu email para completar el acceso:") || "";
  try {
    await auth.signInWithEmailLink(email, window.location.href);
    localStorage.removeItem("emailForSignIn");
    history.replaceState(null, "", window.location.pathname);
  } catch (e) {
    console.error(e);
    showToast("⚠️ El enlace no es válido o ha caducado.");
  }
}

// ---- Eventos ------------------------------------------------
function wireEvents() {
  // Login Google
  $("google-btn").addEventListener("click", async () => {
    try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
    catch (e) { console.error(e); showToast("⚠️ No se pudo entrar con Google"); }
  });
  // Login email
  $("email-btn").addEventListener("click", async () => {
    const email = $("email-input").value.trim();
    if (!email) { $("email-input").focus(); return; }
    try {
      await auth.sendSignInLinkToEmail(email, { url: location.origin + location.pathname, handleCodeInApp: true });
      localStorage.setItem("emailForSignIn", email);
      $("email-msg").textContent = "✅ Enlace enviado a " + email + ". Ábrelo en este mismo móvil.";
    } catch (e) { console.error(e); $("email-msg").textContent = "⚠️ " + e.message; }
  });
  $("email-input").addEventListener("keydown", e => { if (e.key === "Enter") $("email-btn").click(); });

  // Menú de usuario
  $("user-btn").addEventListener("click", e => { e.stopPropagation(); $("user-dropdown").classList.toggle("hidden"); });
  document.addEventListener("click", () => $("user-dropdown").classList.add("hidden"));
  $("user-dropdown").addEventListener("click", e => e.stopPropagation());

  // Perfil
  $("profile-btn").addEventListener("click", () => {
    $("user-dropdown").classList.add("hidden");
    $("profile-name").value = state.profile.displayName || "";
    show($("profile-modal")); $("profile-name").focus();
  });
  $("profile-close").addEventListener("click", () => hide($("profile-modal")));
  $("profile-save").addEventListener("click", async () => { await saveProfileName($("profile-name").value); hide($("profile-modal")); });

  // Crear grupo
  $("create-btn").addEventListener("click", openCreateModal);
  $("newgroup-btn").addEventListener("click", openCreateModal);
  $("create-close").addEventListener("click", () => hide($("create-modal")));
  $("cg-create").addEventListener("click", createGroup);

  // Lista de grupos
  $("groups-list").addEventListener("click", e => {
    const card = e.target.closest("[data-gid]");
    if (card) location.hash = "#/g/" + card.dataset.gid;
  });

  // Cerrar sesión
  $("signout-btn").addEventListener("click", () => auth.signOut());

  // Grupo: volver
  $("back-btn").addEventListener("click", () => { location.hash = "#/"; });

  // Grupo: pestañas
  document.querySelectorAll("[data-gtab]").forEach(t => t.addEventListener("click", () => {
    if (!state.g) return;
    state.g.tab = t.dataset.gtab;
    renderGroup();
  }));

  // Grupo: base Libre/Ocupado
  document.querySelectorAll("[data-base]").forEach(b => b.addEventListener("click", () => {
    if (state.g) setBaseline(b.dataset.base);
  }));

  // Grupo: tocar días / semanas
  $("calendar").addEventListener("click", e => {
    if (!state.g) return;
    const wk = e.target.closest("[data-week]");
    if (wk) { cycleWeek(wk.dataset.week.split(",")); return; }
    const day = e.target.closest("[data-date]");
    if (!day) return;
    if (state.g.tab === "mine") cycleDay(day.dataset.date);
    else showGDetail(day.dataset.date);
  });
  $("gdetail-close").addEventListener("click", () => hide($("gdetail")));

  // Compartir
  $("share-btn").addEventListener("click", openShare);
  $("share-close").addEventListener("click", () => hide($("share-modal")));
  $("share-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("share-link").value); showToast("📋 Enlace copiado"); }
    catch (e) { $("share-link").select(); showToast("Selecciona y copia el enlace"); }
  });
  $("share-native").addEventListener("click", async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "Únete a mi grupo de vacaciones", url: $("share-link").value }); }
      catch (e) {}
    } else { showToast("Tu navegador no permite compartir directo; usa Copiar"); }
  });

  // Unirse
  $("join-accept").addEventListener("click", joinGroup);
  $("join-cancel").addEventListener("click", () => { hide($("join-modal")); location.hash = "#/"; });
}

// ---- Arranque -----------------------------------------------
async function init() {
  if (!firebaseReady) {
    hide($("loading-view"));
    $("config-warning").classList.remove("hidden");
    setView("login");
    return;
  }
  wireEvents();
  await completeEmailLinkIfPresent();
  window.addEventListener("hashchange", router);
  auth.onAuthStateChanged(async user => {
    if (user) {
      try {
        await ensureProfile(user);
        paintUser();
        subscribeGroups();
        router();
      } catch (e) { console.error(e); showToast("⚠️ Error cargando tu perfil"); showLogin(); }
    } else {
      showLogin();
    }
  });
}
init();
