import React from "react";
import { useTranslation } from "react-i18next";

/** Botón de cabecera que abre la ventana "Acerca de" (`src/about.html`), una ventana nativa aparte. */
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
