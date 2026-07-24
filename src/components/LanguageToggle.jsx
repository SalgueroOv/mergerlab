import React from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from "../i18n/index.js";

/**
 * Selector de idioma de la cabecera. Es un `<select>` nativo (no un grupo de botones como
 * `ThemeToggle`) porque con 8 idiomas un segmented control no entraría cómodo en el header.
 * `App.jsx` es quien persiste la elección (`window.electronAPI.setLanguage`) y llama a
 * `i18n.changeLanguage`; este componente solo renderiza las opciones y avisa del cambio.
 * @param {{language: string, onChange: (code: string) => void}} props
 */
export default function LanguageToggle({ language, onChange }) {
  const { t } = useTranslation();

  return (
    <select
      className="language-select"
      aria-label={t("language.ariaLabel")}
      value={language}
      onChange={(e) => onChange(e.target.value)}
    >
      {SUPPORTED_LANGUAGES.map((code) => (
        <option key={code} value={code}>
          {LANGUAGE_NAMES[code]}
        </option>
      ))}
    </select>
  );
}
