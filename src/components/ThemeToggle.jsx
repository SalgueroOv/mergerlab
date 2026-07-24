import React from "react";
import { useTranslation } from "react-i18next";

const OPTIONS = [
  { value: "system", labelKey: "theme.system" },
  { value: "light", labelKey: "theme.light" },
  { value: "dark", labelKey: "theme.dark" },
];

/**
 * Selector de tema (Sistema/Claro/Oscuro). El tema en sí lo aplica
 * `nativeTheme.themeSource` en `electron/main.js`, no CSS local: este componente solo refleja
 * el valor actual y avisa del cambio, la persistencia también la gestiona el proceso principal.
 * @param {{theme: "system"|"light"|"dark", onChange: (theme: string) => void}} props
 */
export default function ThemeToggle({ theme, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="theme-toggle" role="radiogroup" aria-label={t("theme.ariaLabel")}>
      {OPTIONS.map((option) => {
        const selected = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`theme-toggle-btn ${selected ? "selected" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
