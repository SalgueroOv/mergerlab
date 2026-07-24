import i18next from "i18next";
import es from "./i18n/locales/es.json";
import en from "./i18n/locales/en.json";
import de from "./i18n/locales/de.json";
import fr from "./i18n/locales/fr.json";
import it from "./i18n/locales/it.json";
import pt from "./i18n/locales/pt.json";
import ru from "./i18n/locales/ru.json";
import zh from "./i18n/locales/zh.json";
import { SUPPORTED_LANGUAGES } from "./i18n/index.js";

// La ventana "Acerca de" (src/about.html + src/about.js) es un proceso de renderer separado de
// la ventana principal — no comparte memoria ni el módulo src/i18n/index.js en tiempo de
// ejecución — así que necesita su propia instancia de i18next, aunque reutiliza los mismos
// archivos de traducción.
const resources = {
  es: { translation: es },
  en: { translation: en },
  de: { translation: de },
  fr: { translation: fr },
  it: { translation: it },
  pt: { translation: pt },
  ru: { translation: ru },
  zh: { translation: zh },
};

export async function initAboutI18n() {
  const stored = await window.aboutAPI.getLanguage();
  const language = SUPPORTED_LANGUAGES.includes(stored) ? stored : "es";

  await i18next.init({
    resources,
    lng: language,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });

  return i18next;
}

export default i18next;
