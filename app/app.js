// =============================================================
//  Vacaciones en grupo — Fase 1: Login (Google + email) + Perfil
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
} catch (e) {
  console.error("No se pudo iniciar Firebase:", e);
}

// ---- Atajos al DOM ------------------------------------------
const $ = id => document.getElementById(id);
const els = {
  loading: $("loading-view"),
  login: $("login-view"),
  topbar: $("topbar"),
  home: $("home-view"),
  googleBtn: $("google-btn"),
  emailInput: $("email-input"),
  emailBtn: $("email-btn"),
  emailMsg: $("email-msg"),
  userBtn: $("user-btn"),
  userAvatar: $("user-avatar"),
  dropdown: $("user-dropdown"),
  ddName: $("dd-name"),
  ddEmail: $("dd-email"),
  profileBtn: $("profile-btn"),
  newgroupBtn: $("newgroup-btn"),
  signoutBtn: $("signout-btn"),
  profileModal: $("profile-modal"),
  profileName: $("profile-name"),
  profileSave: $("profile-save"),
  profileClose: $("profile-close"),
};

let currentProfile = null; // { displayName, email, ... }

// ---- Utilidades ---------------------------------------------
function show(view) { view.classList.remove("hidden"); }
function hide(view) { view.classList.add("hidden"); }

let toastTimer = null;
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2800);
}

function initial(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

// ---- Perfil -------------------------------------------------
async function ensureProfile(user) {
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();
  if (snap.exists) {
    currentProfile = snap.data();
  } else {
    let name = (user.displayName || "").trim();
    if (!name) {
      name = (window.prompt("¿Cómo te llamas? (es el nombre que verá tu grupo)") || "").trim();
    }
    if (!name) name = (user.email || "Usuario").split("@")[0];
    currentProfile = {
      displayName: name,
      email: user.email || "",
      photoURL: user.photoURL || "",
      createdAt: Date.now(),
    };
    await ref.set(currentProfile);
  }
}

async function saveProfileName(newName) {
  const name = (newName || "").trim();
  if (!name) return;
  await db.collection("users").doc(auth.currentUser.uid).set(
    { displayName: name }, { merge: true }
  );
  currentProfile.displayName = name;
  paintUser();
  showToast("✅ Perfil actualizado");
}

// ---- Pintar estado logueado ---------------------------------
function paintUser() {
  const name = currentProfile.displayName || "Usuario";
  els.userAvatar.textContent = initial(name);
  els.ddName.textContent = name;
  els.ddEmail.textContent = currentProfile.email || "";
}

function showHome() {
  hide(els.loading);
  hide(els.login);
  show(els.topbar);
  show(els.home);
  paintUser();
}

function showLogin() {
  hide(els.loading);
  hide(els.topbar);
  hide(els.home);
  show(els.login);
}

// ---- Flujo de email link ------------------------------------
async function completeEmailLinkIfPresent() {
  if (!firebaseReady) return;
  if (!auth.isSignInWithEmailLink(window.location.href)) return;
  let email = localStorage.getItem("emailForSignIn");
  if (!email) {
    email = window.prompt("Confirma tu email para completar el acceso:") || "";
  }
  try {
    await auth.signInWithEmailLink(email, window.location.href);
    localStorage.removeItem("emailForSignIn");
    // Limpia el enlace de la barra de direcciones
    history.replaceState(null, "", window.location.pathname);
  } catch (e) {
    console.error(e);
    showLogin();
    els.emailMsg.textContent = "⚠️ El enlace no es válido o ha caducado. Pídelo de nuevo.";
  }
}

// ---- Eventos ------------------------------------------------
function wireEvents() {
  // Entrar con Google
  els.googleBtn.addEventListener("click", async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      console.error(e);
      showToast("⚠️ No se pudo entrar con Google");
    }
  });

  // Enviar enlace por email
  els.emailBtn.addEventListener("click", async () => {
    const email = els.emailInput.value.trim();
    if (!email) { els.emailInput.focus(); return; }
    const actionCodeSettings = {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    };
    try {
      await auth.sendSignInLinkToEmail(email, actionCodeSettings);
      localStorage.setItem("emailForSignIn", email);
      els.emailMsg.textContent = "✅ Enlace enviado a " + email + ". Ábrelo en este mismo móvil.";
    } catch (e) {
      console.error(e);
      els.emailMsg.textContent = "⚠️ " + e.message;
    }
  });
  els.emailInput.addEventListener("keydown", e => {
    if (e.key === "Enter") els.emailBtn.click();
  });

  // Menú de usuario
  els.userBtn.addEventListener("click", e => {
    e.stopPropagation();
    els.dropdown.classList.toggle("hidden");
  });
  document.addEventListener("click", () => els.dropdown.classList.add("hidden"));
  els.dropdown.addEventListener("click", e => e.stopPropagation());

  // Editar perfil
  els.profileBtn.addEventListener("click", () => {
    els.dropdown.classList.add("hidden");
    els.profileName.value = currentProfile.displayName || "";
    show(els.profileModal);
    els.profileName.focus();
  });
  els.profileClose.addEventListener("click", () => hide(els.profileModal));
  els.profileSave.addEventListener("click", async () => {
    await saveProfileName(els.profileName.value);
    hide(els.profileModal);
  });

  // Crear grupo (Fase 2)
  els.newgroupBtn.addEventListener("click", () => {
    els.dropdown.classList.add("hidden");
    showToast("➕ Crear grupo llega en la Fase 2");
  });

  // Cerrar sesión
  els.signoutBtn.addEventListener("click", () => auth.signOut());
}

// ---- Arranque -----------------------------------------------
async function init() {
  if (!firebaseReady) {
    hide(els.loading);
    $("config-warning").classList.remove("hidden");
    show(els.login);
    return;
  }
  wireEvents();
  await completeEmailLinkIfPresent();

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      try {
        await ensureProfile(user);
        showHome();
      } catch (e) {
        console.error("Error cargando perfil:", e);
        showToast("⚠️ Error cargando tu perfil");
        showLogin();
      }
    } else {
      showLogin();
    }
  });
}
init();
