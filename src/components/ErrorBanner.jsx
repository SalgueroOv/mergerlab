import React from "react";
import { useTranslation } from "react-i18next";

/**
 * Aviso de error descartable bajo la cabecera. Hoy solo lo usa `App.jsx` para el mensaje que
 * llega cuando el proceso backend se cae de forma inesperada tras haber arrancado bien (ver
 * canal IPC `"backend-error"` en `electron/main.js`); no se muestra nada si `message` es falsy.
 * @param {{message: string | null, onDismiss: () => void}} props
 */
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
