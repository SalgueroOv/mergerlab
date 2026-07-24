import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { extensionOf, formatMetaFor } from "../formatMeta.js";

const ACCEPTED_EXTENSIONS = new Set(["xls", "xlsx", "csv", "ods"]);

/**
 * Zona de carga (clic o arrastrar-y-soltar) y lista reordenable de los archivos de entrada.
 * El propio componente no guarda la lista de archivos: solo dispara los callbacks (`onAddFiles`,
 * `onRemove`, `onReorder`) y `App.jsx` es quien mantiene el estado real en `files`.
 * @param {{
 *   files: {path: string, name: string, size: number|null}[],
 *   onAddFiles: (paths?: string[]) => void,
 *   onRemove: (index: number) => void,
 *   onReorder: (fromIndex: number, toIndex: number) => void,
 *   disabled: boolean,
 * }} props
 */
export default function FileList({ files, onAddFiles, onRemove, onReorder, disabled }) {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [rejected, setRejected] = useState(0);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const rejectTimer = useRef(null);

  const flashRejected = useCallback((count) => {
    setRejected(count);
    clearTimeout(rejectTimer.current);
    rejectTimer.current = setTimeout(() => setRejected(0), 3500);
  }, []);

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
    async (event) => {
      if (disabled || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setIsDragOver(false);

      const droppedFiles = Array.from(event.dataTransfer.files);
      // Los objetos File del navegador no exponen la ruta absoluta en disco; getPathForFile
      // usa webUtils de Electron (ver preload.js) para recuperarla.
      const paths = droppedFiles.map((file) => window.electronAPI.getPathForFile(file));
      const accepted = paths.filter((p) => ACCEPTED_EXTENSIONS.has(extensionOf(p)));

      if (accepted.length > 0) onAddFiles(accepted);
      if (accepted.length < paths.length) flashRejected(paths.length - accepted.length);
    },
    [disabled, onAddFiles, flashRejected]
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

      {rejected > 0 && <p className="dropzone-warning">{t("fileList.rejected", { count: rejected })}</p>}

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
