import React from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from "../i18n/index.js";

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
