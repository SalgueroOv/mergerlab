import React from "react";
import { useTranslation } from "react-i18next";
import { FORMAT_ORDER, FORMAT_META } from "../formatMeta.js";

export default function FormatPicker({ value, onChange, disabled }) {
  const { t } = useTranslation();
  return (
    <div className="format-picker" role="radiogroup" aria-label={t("format.ariaLabel")}>
      {FORMAT_ORDER.map((format) => {
        const selected = value === format;
        return (
          <button
            key={format}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`format-pill ${selected ? "selected" : ""}`}
            disabled={disabled}
            onClick={() => onChange(format)}
          >
            {FORMAT_META[format].label}
          </button>
        );
      })}
    </div>
  );
}
