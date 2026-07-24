import React from "react";
import { useTranslation } from "react-i18next";

const OPTIONS = [
  { value: "system", labelKey: "theme.system" },
  { value: "light", labelKey: "theme.light" },
  { value: "dark", labelKey: "theme.dark" },
];

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
