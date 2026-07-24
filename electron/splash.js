// Diccionario mínimo propio: esta pantalla se muestra antes de que exista React/i18next, así
// que no puede depender de src/i18n/. El idioma llega por query string (ver electron/main.js,
// createSplashWindow) y ya está resuelto (persistido o detectado del sistema) antes de crear
// esta ventana. Externalizado en vez de inline porque la CSP de producción (script-src 'self',
// ver applyContentSecurityPolicy en electron/main.js) bloquea los <script> inline.
const LOADING_TEXT = {
  es: "Cargando…",
  en: "Loading…",
  de: "Wird geladen…",
  fr: "Chargement…",
  it: "Caricamento…",
  pt: "Carregando…",
  ru: "Загрузка…",
  zh: "正在加载…",
};

const lang = new URLSearchParams(window.location.search).get("lang");
document.getElementById("label").textContent = LOADING_TEXT[lang] || LOADING_TEXT.es;
document.documentElement.lang = lang || "es";
