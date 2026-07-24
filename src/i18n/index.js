import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./locales/es.json";
import en from "./locales/en.json";
import de from "./locales/de.json";
import fr from "./locales/fr.json";
import it from "./locales/it.json";
import pt from "./locales/pt.json";
import ru from "./locales/ru.json";
import zh from "./locales/zh.json";

export const SUPPORTED_LANGUAGES = ["es", "en", "de", "fr", "it", "pt", "ru", "zh"];

// Nombres mostrados en el propio idioma (convención habitual de los selectores de idioma: no
// se traducen entre sí, cada uno se lee en su propia lengua).
export const LANGUAGE_NAMES = {
  es: "Español",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  pt: "Português",
  ru: "Русский",
  zh: "简体中文",
};

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

/**
 * Inicializa i18next con el idioma persistido en Electron (o el detectado del sistema si es la
 * primera vez que se abre la app — ver `detectSystemLanguage` en electron/main.js).
 * @returns {Promise<import("i18next").i18n>}
 */
export async function initI18n() {
  const stored = await window.electronAPI.getLanguage();
  const initialLanguage = SUPPORTED_LANGUAGES.includes(stored) ? stored : "es";

  await i18next.use(initReactI18next).init({
    resources,
    lng: initialLanguage,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });

  return i18next;
}

export default i18next;
