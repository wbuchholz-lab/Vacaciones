# 🏖️ Días de vacaciones

App web sencilla para que un grupo coordine sus días libres en vacaciones.
Cada persona marca en un calendario qué días tiene **Ocupados** o **Inseguros**;
todo lo demás se considera **Libre**. Hay una vista de **resumen del grupo** con un
mapa de calor para ver de un vistazo qué días coincidís libres.

- 📱 Pensada para el móvil. Solo hay que abrir un enlace.
- 🔄 Los cambios se sincronizan en tiempo real entre todos (Firebase Firestore).
- 🆓 Hosting gratis en GitHub Pages.
- 🙅 Sin registros: cada persona solo escribe su nombre.

---

## 1) Configurar Firebase (lo haces una vez, ~5 min)

1. Entra en <https://console.firebase.google.com> y pulsa **Crear un proyecto**
   (puedes desactivar Google Analytics, no hace falta).
2. Dentro del proyecto, en el menú izquierdo abre **Compilación → Firestore Database**
   y pulsa **Crear base de datos**.
   - Elige **Iniciar en modo de prueba** y la región que quieras (p. ej. *eur3*).
3. Vuelve a **⚙️ Configuración del proyecto** (arriba a la izquierda).
   En la pestaña **General**, baja hasta **Tus apps** y pulsa el icono **`</>`** (Web).
   - Ponle un apodo (p. ej. *vacaciones*) y pulsa **Registrar app**.
   - Te mostrará un bloque `const firebaseConfig = { ... }`. **Copia esos valores.**
4. Abre el archivo **`firebase-config.js`** de este proyecto y **pega tus valores**
   sustituyendo los `<PEGA_AQUÍ>`.

### Reglas de seguridad de Firestore

El "modo de prueba" caduca a los 30 días. Para que siga funcionando, ve a
**Firestore Database → Reglas** y pega esto:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /participants/{id} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ Esto deja la base de datos abierta a cualquiera que tenga el enlace.
> Para un grupo de amigos suele bastar. Si quieres un mínimo control extra,
> abre `app.js` y pon una palabra en `CONFIG.passphrase` (pedirá esa clave al entrar).

---

## 2) Subir a GitHub y publicar

1. Crea un repositorio nuevo en <https://github.com/new> (puede ser **público**;
   recuerda que las claves de Firebase web son públicas por diseño).
2. Sube estos archivos al repositorio. Si usas la terminal:

   ```bash
   git init
   git add .
   git commit -m "App de días de vacaciones"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```

3. En el repo: **Settings → Pages**. En **Branch** elige `main` y carpeta `/ (root)`,
   y pulsa **Save**.
4. En 1-2 minutos tendrás tu enlace:
   `https://TU_USUARIO.github.io/TU_REPO/`
5. **Manda ese enlace al grupo.** ¡Listo!

---

## Cómo se usa

- **Mi calendario:** escribe tu nombre y toca un día para cambiar su estado:
  *Libre → Ocupado → Inseguro → Libre*. El botón **sem** cambia la semana entera.
- **Resumen del grupo:** mapa de calor con cuánta gente está libre cada día
  (verde = todos libres, rojo = pocos). Toca un día para ver quién está libre/ocupado/inseguro.
- Tu nombre se guarda en tu móvil, así que no hace falta volver a escribirlo.

## Cambiar el periodo del calendario

Abre `app.js` y edita al principio:

```js
const CONFIG = {
  startMonth: "2026-06",  // primer mes
  endMonth:   "2026-09",  // último mes
  passphrase: ""          // clave opcional
};
```

## Probar en tu ordenador (opcional)

Puedes abrir `index.html` directamente en el navegador. Si tu navegador diera
problemas, levanta un servidor local:

```bash
python -m http.server 8000
# y abre http://localhost:8000
```
