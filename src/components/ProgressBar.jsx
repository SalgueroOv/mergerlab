import React from "react";

export default function ProgressBar({ state, progress, message, processed, total, resultPath, onOpenFolder }) {
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
              Completado — archivo guardado en <strong>{resultPath}</strong>
              {onOpenFolder && (
                <button type="button" className="link-btn" onClick={() => onOpenFolder(resultPath)}>
                  Abrir carpeta
                </button>
              )}
            </>
          ) : (
            message
          )}
        </span>
        {state === "running" && (
          <span className="progress-count">
            {processed != null ? `${processed} / ${total} archivos` : `${total} archivos`}
          </span>
        )}
      </div>
    </div>
  );
}
