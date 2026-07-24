import React from "react";
import { useTranslation } from "react-i18next";

export default function ErrorBanner({ message, onDismiss }) {
  const { t } = useTranslation();
  if (!message) return null;

  return (
    <div className="banner banner-error" role="alert">
      <span className="banner-icon">⚠</span>
      <span className="banner-text">{message}</span>
      <button type="button" className="banner-close" onClick={onDismiss} aria-label={t("common.close")}>
        ✕
      </button>
    </div>
  );
}
