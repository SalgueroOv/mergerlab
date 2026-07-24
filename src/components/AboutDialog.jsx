import React from "react";
import { useTranslation } from "react-i18next";

export default function AboutDialog() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="btn subtle about-trigger-btn"
      onClick={() => window.electronAPI.openAboutWindow()}
    >
      {t("about.trigger")}
    </button>
  );
}
