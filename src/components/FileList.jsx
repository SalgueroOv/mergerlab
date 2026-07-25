import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { extensionOf, formatMetaFor } from "../formatMeta.js";

/**
 * Zona de carga (clic o arrastrar-y-soltar) y lista reordenable de los archivos de entrada.
 * El propio componente no guarda la lista de archivos ni decide qué extensiones se aceptan: eso
 * vive en `App.jsx` (`handleFilesDropped`), compartido con el drop sobre toda la ventana (ver
 * `WindowDropOverlay` en `App.jsx`) para que ambas zonas de drop se comporten igual.
 * @param {{
 *   files: {path: string, name: string, size: number|null}[],
 *   onAddFiles: (paths?: string[]) => void,
 *   onFilesDropped: (paths: string[]) => void,
 *   rejectedCount: number,
 *   onRemove: (index: number) => void,
 *   onReorder: (fromIndex: number, toIndex: number) => void,
 *   disabled: boolean,
 * }} props
 */
export default function FileList({
  files,
  onAddFiles,
  onFilesDropped,
  rejectedCount,
  onRemove,
  onReorder,
  disabled,
}) {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const handleZoneDragOver = useCallback(
    (event) => {
      if (disabled || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setIsDragOver(true);
    },
    [disabled]
  );

  const handleZoneDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleZoneDrop = useCallback(
    (event) => {
      if (disabled || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setIsDragOver(false);

      const droppedFiles = Array.from(event.dataTransfer.files);
      // Los objetos File del navegador no exponen la ruta absoluta en disco; getPathForFile
      // usa webUtils de Electron (ver preload.js) para recuperarla.
      const paths = droppedFiles.map((file) => window.electronAPI.getPathForFile(file));
      onFilesDropped(paths);
    },
    [disabled, onFilesDropped]
  );

  const handleZoneClick = useCallback(() => {
    if (!disabled) onAddFiles();
  }, [disabled, onAddFiles]);

  const handleItemDragStart = useCallback(
    (index) => (event) => {
      setDragIndex(index);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    },
    []
  );

  const handleItemDragOver = useCallback(
    (index) => (event) => {
      if (dragIndex === null) return;
      event.preventDefault();
      setOverIndex(index);
    },
    [dragIndex]
  );

  const handleItemDrop = useCallback(
    (index) => (event) => {
      if (dragIndex === null) return;
      event.preventDefault();
      if (dragIndex !== index) onReorder(dragIndex, index);
      setDragIndex(null);
      setOverIndex(null);
    },
    [dragIndex, onReorder]
  );

  const handleItemDragEnd = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  return (
    <div className="file-list-wrap">
      <div
        className={`dropzone ${isDragOver ? "drag-over" : ""} ${disabled ? "disabled" : ""}`}
        onDragOver={handleZoneDragOver}
        onDragLeave={handleZoneDragLeave}
        onDrop={handleZoneDrop}
        onClick={handleZoneClick}
        role="button"
        tabIndex={disabled ? -1 : 0}
      >
        <svg
          className="dropzone-icon"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 4v11m0-11 4 4m-4-4-4 4M5 17.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p>{t("fileList.dropHint")}</p>
        <p className="dropzone-hint">{t("fileList.supportedFormats")}</p>
      </div>

      {rejectedCount > 0 && (
        <p className="dropzone-warning">{t("fileList.rejected", { count: rejectedCount })}</p>
      )}

      {files.length > 0 && (
        <ol className="file-list">
          {files.map((file, index) => {
            const meta = formatMetaFor(extensionOf(file.name));
            return (
              <li
                key={file.path}
                className={`file-list-item ${dragIndex === index ? "dragging" : ""} ${
                  overIndex === index && dragIndex !== null && dragIndex !== index ? "drag-over" : ""
                }`}
                draggable={!disabled}
                onDragStart={handleItemDragStart(index)}
                onDragOver={handleItemDragOver(index)}
                onDrop={handleItemDrop(index)}
                onDragEnd={handleItemDragEnd}
              >
                <span className="drag-handle" aria-hidden="true">
                  ⠿
                </span>
                <span className="file-badge" style={{ "--badge-color": meta.color }}>
                  {meta.label}
                </span>
                <span className="file-name" title={file.path}>
                  {file.name}
                </span>
                <button
                  type="button"
                  className="icon-btn danger"
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                  aria-label={t("fileList.removeFile")}
                  title={t("fileList.removeFile")}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
