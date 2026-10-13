import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { extensionOf, formatMetaFor } from "../formatMeta.js";
import { backendText } from "../i18n/backendMessages.js";

// Separadores de CSV que se ofrecen en el desplegable de cada archivo (los mismos candidatos que
// prueba la detección automática del backend, ver CSV_SEPARATOR_CANDIDATES en merger.py), con la
// clave de su etiqueta traducida. Cualquier otro carácter se elige con la opción "Otro".
const CSV_SEPARATOR_OPTIONS = [
  { value: ",", labelKey: "fileList.csv.comma" },
  { value: ";", labelKey: "fileList.csv.semicolon" },
  { value: "\t", labelKey: "fileList.csv.tab" },
  { value: "|", labelKey: "fileList.csv.pipe" },
];

/**
 * Etiqueta legible de un separador de CSV (p. ej. "Punto y coma (;)"), o el propio carácter
 * entre comillas si no es uno de `CSV_SEPARATOR_OPTIONS`.
 * @param {string} separator
 * @param {import("i18next").TFunction} t
 * @returns {string}
 */
function separatorLabel(separator, t) {
  const option = CSV_SEPARATOR_OPTIONS.find((o) => o.value === separator);
  return option ? t(option.labelKey) : `"${separator}"`;
}

/**
 * Devuelve una copia de `set` con `value` añadido (`include = true`) o quitado.
 * @param {Set<string>} set
 * @param {string} value
 * @param {boolean} include
 * @returns {Set<string>}
 */
function toggledSet(set, value, include) {
  const next = new Set(set);
  if (include) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * Zona de carga (clic o arrastrar-y-soltar) y lista reordenable de los archivos de entrada.
 * El propio componente no guarda la lista de archivos ni decide qué extensiones se aceptan: eso
 * vive en `App.jsx` (`handleFilesDropped`), compartido con el drop sobre toda la ventana (ver
 * `WindowDropOverlay` en `App.jsx`) para que ambas zonas de drop se comporten igual.
 *
 * Debajo de cada `.csv` se muestra con qué separador se va a leer (detectado automáticamente o
 * elegido a mano), un aviso si la detección no está segura y una vista previa opcional de las
 * primeras filas. `csvInfoByPath` (resultado de `inspectCsv` en `src/api.js`) y los separadores
 * elegidos a mano (`csvSeparators`) viven en `App.jsx`, no en este componente.
 * @param {{
 *   files: {path: string, name: string, size: number|null}[],
 *   onAddFiles: (paths?: string[]) => void,
 *   onFilesDropped: (paths: string[]) => void,
 *   rejectedCount: number,
 *   onRemove: (index: number) => void,
 *   onReorder: (fromIndex: number, toIndex: number) => void,
 *   csvInfoByPath: Record<string, object>,
 *   csvSeparators: Record<string, string>,
 *   onCsvSeparatorChange: (path: string, separator: string) => void,
 *   sheetsByPath: Record<string, string[]>,
 *   selectedSheets: Record<string, string>,
 *   onSheetChange: (path: string, sheet: string) => void,
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
  csvInfoByPath,
  csvSeparators,
  onCsvSeparatorChange,
  sheetsByPath = {},
  selectedSheets = {},
  onSheetChange,
  disabled,
}) {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  // Rutas de los CSV con la vista previa desplegada, y de los que tienen elegida la opción "Otro"
  // del desplegable de separador (se guarda aparte porque, mientras el campo del carácter está
  // vacío, no hay separador elegido a mano y el archivo se sigue leyendo en automático).
  const [previewPaths, setPreviewPaths] = useState(() => new Set());
  const [otherPaths, setOtherPaths] = useState(() => new Set());

  const handleSeparatorSelect = useCallback(
    (path, value) => {
      setOtherPaths((prev) => toggledSet(prev, path, value === "other"));
      onCsvSeparatorChange(path, value === "auto" || value === "other" ? "" : value);
    },
    [onCsvSeparatorChange]
  );

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

  /**
   * Controles de un `.csv` dentro de su fila: desplegable del separador, campo del carácter si
   * se elige "Otro", botón de vista previa, aviso de detección dudosa o error de lectura, y la
   * propia vista previa si está desplegada.
   * @param {{path: string, name: string}} file
   */
  const renderCsvOptions = (file) => {
    const info = csvInfoByPath[file.path];
    const manual = csvSeparators[file.path] || "";
    const isStandard = CSV_SEPARATOR_OPTIONS.some((o) => o.value === manual);
    const selectValue = manual
      ? isStandard
        ? manual
        : "other"
      : otherPaths.has(file.path)
        ? "other"
        : "auto";
    const readable = info && !info.error;
    const showPreview = readable && previewPaths.has(file.path);
    // El separador detectado solo se conoce cuando el archivo se está leyendo en automático: con
    // uno elegido a mano, `info.separator` es ese mismo.
    const autoLabel =
      readable && !manual
        ? t("fileList.csv.autoDetected", { separator: separatorLabel(info.separator, t) })
        : t("fileList.csv.auto");

    return (
      <div className="csv-options">
        <div className="csv-options-row">
          <label className="csv-options-label" htmlFor={`csv-sep-${file.path}`}>
            {t("fileList.csv.separatorLabel")}
          </label>
          <select
            id={`csv-sep-${file.path}`}
            className="destination-input csv-separator-select"
            value={selectValue}
            disabled={disabled}
            onChange={(e) => handleSeparatorSelect(file.path, e.target.value)}
          >
            <option value="auto">{autoLabel}</option>
            {CSV_SEPARATOR_OPTIONS.map((o) => (
              <option key={o.labelKey} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
            <option value="other">{t("fileList.csv.other")}</option>
          </select>
          {selectValue === "other" && (
            <input
              type="text"
              className="destination-input csv-separator-other"
              maxLength={1}
              value={isStandard ? "" : manual}
              disabled={disabled}
              placeholder={t("fileList.csv.otherPlaceholder")}
              aria-label={t("fileList.csv.otherAriaLabel", { file: file.name })}
              onChange={(e) => onCsvSeparatorChange(file.path, e.target.value)}
            />
          )}
          <button
            type="button"
            className="btn subtle csv-preview-toggle"
            disabled={!readable}
            aria-expanded={showPreview}
            onClick={() => setPreviewPaths((prev) => toggledSet(prev, file.path, !prev.has(file.path)))}
          >
            {showPreview ? t("fileList.csv.hidePreview") : t("fileList.csv.showPreview")}
          </button>
        </div>

        {info && info.error && <p className="csv-options-error">{backendText(info.error, t)}</p>}
        {readable && !info.confident && <p className="csv-options-warning">{t("fileList.csv.unsure")}</p>}

        {showPreview && (
          <div className="csv-preview">
            <table>
              <thead>
                <tr>
                  {info.columns.map((col, i) => (
                    <th key={i}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {info.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {info.rows.length === 0 && <p className="csv-preview-empty">{t("fileList.csv.previewEmpty")}</p>}
          </div>
        )}
      </div>
    );
  };

  /**
   * Selector de hoja de un Excel/ODS con más de una hoja: "Todas las hojas" (por defecto, se
   * combinan todas) o una hoja concreta.
   * @param {{path: string, name: string}} file
   */
  const renderSheetOptions = (file) => {
    const sheets = sheetsByPath[file.path] || [];
    if (sheets.length < 2) return null;
    const id = `sheet-${file.path}`;
    return (
      <div className="csv-options">
        <div className="csv-options-row">
          <label className="csv-options-label" htmlFor={id}>
            {t("fileList.sheets.label")}
          </label>
          <select
            id={id}
            className="destination-input csv-separator-select"
            value={selectedSheets[file.path] || ""}
            disabled={disabled}
            onChange={(e) => onSheetChange(file.path, e.target.value)}
          >
            <option value="">{t("fileList.sheets.all", { count: sheets.length })}</option>
            {sheets.map((sheet) => (
              <option key={sheet} value={sheet}>
                {sheet}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

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
                {extensionOf(file.name) === "csv" && renderCsvOptions(file)}
                {extensionOf(file.name) !== "csv" && renderSheetOptions(file)}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
