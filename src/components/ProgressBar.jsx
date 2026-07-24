import React from "react";
import { useTranslation } from "react-i18next";

/**
 * Barra de progreso de la combinación en curso, con el mensaje de estado del backend
 * (ya traducido por `App.jsx` vía `src/i18n/backendMessages.js`) y, al terminar con éxito, la
 * ruta del resultado con un botón para abrir su carpeta.
 * @param {{
 *   state: "hidden"|"running"|"success"|"error",
 *   progress: number,
 *   message: string,
 *   processed: number|null,
 *   total: number,
 *   resultPath: string|null,
 *   onOpenFolder?: (path: string) => void,
 * }} props
 */
export default function ProgressBar({
  state,
  progress,
  message,
  processed,
  total,
  resultPath,
  onOpenFolder,
}) {
  const { t } = useTranslation();
  if (state === "hidden") return null;

  const pct = state === "error" ? 100 : Math.min(100, Math.max(0, progress));

  return (
    <div className={`progress-bar progress-bar--${state}`} role="status">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-meta">
        <span className="progress-message">
          {state === "success" && resultPath ? (
            <>
              {t("progress.completedPrefix")} <strong>{resultPath}</strong>
              {onOpenFolder && (
                <button type="button" className="link-btn" onClick={() => onOpenFolder(resultPath)}>
                  {t("progress.openFolder")}
                </button>
              )}
            </>
          ) : (
            message
          )}
        </span>
        {state === "running" && (
          <span className="progress-count">
            {processed != null
              ? t("progress.filesCountWithProcessed", { processed, total })
              : t("progress.filesCountTotalOnly", { total })}
          </span>
        )}
      </div>
    </div>
  );
}
