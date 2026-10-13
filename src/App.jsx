import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FileList from "./components/FileList.jsx";
import FormatPicker from "./components/FormatPicker.jsx";
import JoinPicker from "./components/JoinPicker.jsx";
import StackTutorial from "./components/StackTutorial.jsx";
import ProgressBar from "./components/ProgressBar.jsx";
import ErrorBanner from "./components/ErrorBanner.jsx";
import AboutDialog from "./components/AboutDialog.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";
import LanguageToggle from "./components/LanguageToggle.jsx";
import OnboardingTour, { hasSeenOnboarding } from "./components/OnboardingTour.jsx";
import WindowDropOverlay from "./components/WindowDropOverlay.jsx";
import { startMerge, pollMergeStatus, getColumns, inspectCsv } from "./api.js";
import { backendText } from "./i18n/backendMessages.js";
import { ACCEPTED_INPUT_EXTENSIONS, extensionOf } from "./formatMeta.js";

/**
 * Extrae el nombre de archivo (sin carpetas) de una ruta absoluta, aceptando tanto `/` como `\`
 * como separador (los paths que llegan de Electron son nativos del SO: `\` en Windows).
 * @param {string} fullPath
 * @returns {string}
 */
function pathName(fullPath) {
  const normalized = fullPath.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/**
 * Une una carpeta y un nombre de archivo respetando el separador que ya use `folder`
 * (`\` en Windows, `/` en macOS/Linux), sin duplicarlo si `folder` ya termina en uno.
 * @param {string} folder
 * @param {string} filename
 * @returns {string}
 */
function joinPath(folder, filename) {
  if (!folder) return filename;
  const sep = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return /[\\/]$/.test(folder) ? `${folder}${filename}` : `${folder}${sep}${filename}`;
}

/**
 * Quita del nombre de archivo de salida los caracteres no válidos en nombres de archivo de
 * Windows (que es el subconjunto más restrictivo entre los SO soportados).
 * @param {string} name
 * @returns {string}
 */
function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "").trim();
}

/**
 * Formatea un tamaño en bytes como texto legible (`"1.5 MB"`), eligiendo la unidad más grande
 * que mantenga el valor por debajo de 1024.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Extrae de un estado de trabajo (`GET /api/status/<job_id>`, ver `backend/server.py`) cuántos
 * archivos se llevan procesados, para la cuenta "X / Y archivos" de `ProgressBar`.
 *
 * Prioriza `status.params.index` (valor estructurado que ya manda el backend en los mensajes de
 * progreso) y solo si no está disponible cae a extraerlo por regex del texto `message` en
 * español (p. ej. `"Leído datos.csv (2/5)"`) — esto último es un respaldo para cuando el
 * backend no reconoce un `code` traducible, no el camino habitual.
 * @param {{message?: string, params?: {index?: number}}} status
 * @returns {number | null}
 */
function parseProcessed(status) {
  if (status && status.params && typeof status.params.index === "number") {
    return status.params.index;
  }
  const match = /\((\d+)\/(\d+)\)/.exec((status && status.message) || "");
  return match ? Number(match[1]) : null;
}

// Compara nombres de columna ignorando mayúsculas, acentos, espacios y guiones/guiones bajos,
// para sugerir por defecto columnas que solo difieren "cosméticamente" entre archivos
// (ej. "ID Cliente" / "id_cliente"). Nombres genuinamente distintos ("ID_Cliente" vs
// "Codigo Cliente") no matchean y quedan a elección manual del usuario.
const DIACRITICS_RE = /\p{Diacritic}/gu;

/**
 * Normaliza un nombre de columna para compararlo "a ojo" con el de otro archivo: minúsculas,
 * sin acentos y sin separadores. Ver el comentario de arriba para el criterio completo.
 * @param {string} name
 * @returns {string}
 */
function normalizeColumnName(name) {
  return String(name)
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Componente raíz de la aplicación: junta todo el estado de la pantalla principal (archivos
 * cargados, modo de combinación, configuración de salida, progreso) y coordina los componentes
 * hijos (`FileList`, `JoinPicker`/`FormatPicker`, `ProgressBar`, etc.) y la llamada al backend
 * (`src/api.js`) para lanzar y seguir el trabajo de combinación.
 */
export default function App() {
  const { t, i18n } = useTranslation();
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState("join");
  const [outputFormat, setOutputFormat] = useState("xlsx");
  const [outputFileName, setOutputFileName] = useState("combinado");
  const [destinationFolder, setDestinationFolder] = useState("");
  const [addSourceColumn, setAddSourceColumn] = useState(false);
  const [allAsText, setAllAsText] = useState(false);
  const [outputCsvSeparator, setOutputCsvSeparator] = useState(",");

  // csvSeparators: { [filePath]: separador } — solo los CSV cuyo separador eligió el usuario a
  // mano; los que no aparecen se leen con el separador que detecta el backend.
  const [csvSeparators, setCsvSeparators] = useState({});
  // csvInfoByPath: { [filePath]: resultado de inspectCsv } — cómo va a leer el backend cada CSV
  // (separador, si la detección está segura, vista previa), o `{error}` si no se pudo leer.
  const [csvInfoByPath, setCsvInfoByPath] = useState({});

  const [joinType, setJoinType] = useState("inner");
  // joinKeys: { [filePath]: nombreDeColumnaElegidaEnEseArchivo } — cada archivo puede usar un
  // nombre de columna distinto; el backend las trata como la misma clave al combinar.
  const [joinKeys, setJoinKeys] = useState({});
  const [columnsByPath, setColumnsByPath] = useState({});
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [columnsError, setColumnsError] = useState(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressState, setProgressState] = useState("hidden");
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [processedCount, setProcessedCount] = useState(null);
  const [resultPath, setResultPath] = useState(null);
  const [backendError, setBackendError] = useState(null);
  const [showTour, setShowTour] = useState(false);
  const [theme, setTheme] = useState("system");
  const [language, setLanguage] = useState(i18n.language);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [isWindowDragOver, setIsWindowDragOver] = useState(false);
  const rejectTimerRef = useRef(null);
  // Cuenta de dragenter/dragleave en vez de un booleano: dragleave se dispara al pasar de un
  // hijo a otro dentro de la ventana (no solo al salir de ella del todo), y sin este contador el
  // overlay parpadearía al arrastrar sobre cualquier borde de un elemento interno.
  const dragCounterRef = useRef(0);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onBackendError((code) => {
      setBackendError(code === "backend_crashed" ? t("errors.backendCrashed") : code);
    });
    return unsubscribe;
    // Solo se suscribe una vez: si cambia el idioma mientras hay un backendError visible, ese
    // mensaje puntual queda en el idioma en que ocurrió (no vale la pena re-suscribirse por eso).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.electronAPI.getTheme().then(setTheme);
  }, []);

  const handleThemeChange = useCallback((value) => {
    setTheme(value);
    window.electronAPI.setTheme(value);
  }, []);

  const handleLanguageChange = useCallback(
    (value) => {
      setLanguage(value);
      i18n.changeLanguage(value);
      window.electronAPI.setLanguage(value);
    },
    [i18n]
  );

  useEffect(() => {
    if (!hasSeenOnboarding()) setShowTour(true);
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onReplayOnboarding(() => setShowTour(true));
    return unsubscribe;
  }, []);

  // Rutas de los CSV cargados, como texto (una por línea) para que los efectos que dependen de
  // ellas no se relancen cuando `files` cambia sin que cambien sus CSV (p. ej. al llegar los
  // tamaños de `statFiles` o al reordenar: por eso van ordenadas).
  const csvPathsKey = useMemo(
    () =>
      files
        .filter((f) => extensionOf(f.name) === "csv")
        .map((f) => f.path)
        .sort()
        .join("\n"),
    [files]
  );

  // Descarta los separadores elegidos a mano de archivos que ya no están en la lista.
  useEffect(() => {
    const current = new Set(csvPathsKey ? csvPathsKey.split("\n") : []);
    setCsvSeparators((prev) => {
      const kept = Object.entries(prev).filter(([p]) => current.has(p));
      return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
    });
  }, [csvPathsKey]);

  useEffect(() => {
    const csvPaths = csvPathsKey ? csvPathsKey.split("\n") : [];
    if (csvPaths.length === 0) {
      setCsvInfoByPath({});
      return undefined;
    }

    let cancelled = false;
    inspectCsv(csvPaths, csvSeparators)
      .then((result) => {
        if (!cancelled) setCsvInfoByPath(result);
      })
      .catch((err) => {
        // Fallo de la petición entera (p. ej. backend caído): se muestra el mismo error en cada CSV.
        if (cancelled) return;
        const error = { message: err.message, code: err.code, params: err.params };
        setCsvInfoByPath(Object.fromEntries(csvPaths.map((p) => [p, { error }])));
      });

    return () => {
      cancelled = true;
    };
  }, [csvPathsKey, csvSeparators]);

  const handleCsvSeparatorChange = useCallback((path, separator) => {
    setCsvSeparators((prev) => {
      if ((prev[path] || "") === separator) return prev;
      const next = { ...prev };
      if (separator) next[path] = separator;
      else delete next[path];
      return next;
    });
  }, []);

  useEffect(() => {
    if (mode !== "join" || files.length === 0) {
      setColumnsByPath({});
      setColumnsError(null);
      setLoadingColumns(false);
      return undefined;
    }

    let cancelled = false;
    setLoadingColumns(true);
    setColumnsError(null);

    getColumns(
      files.map((f) => f.path),
      csvSeparators
    )
      .then((result) => {
        if (cancelled) return;
        setColumnsByPath(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setColumnsError(backendText(err, t, t("status.columnsReadGeneric")));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingColumns(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, files, csvSeparators, t]);

  // Sugiere por defecto, para cada archivo, la columna cuyo nombre normalizado coincide en
  // TODOS los archivos (ver normalizeColumnName). Conserva cualquier elección manual ya hecha
  // por el usuario y descarta las de archivos que ya no están en la lista.
  useEffect(() => {
    const paths = Object.keys(columnsByPath);
    if (paths.length === 0) {
      setJoinKeys({});
      return;
    }

    const normalizedSets = paths.map((p) => new Set(columnsByPath[p].map(normalizeColumnName)));
    const commonNormalized = [...normalizedSets[0]].filter((n) => normalizedSets.every((s) => s.has(n)));
    const suggestedNorm = commonNormalized[0];

    setJoinKeys((prev) => {
      const next = {};
      for (const p of paths) {
        const cols = columnsByPath[p];
        if (prev[p] && cols.includes(prev[p])) {
          next[p] = prev[p];
        } else if (suggestedNorm) {
          next[p] = cols.find((c) => normalizeColumnName(c) === suggestedNorm) || "";
        } else {
          next[p] = "";
        }
      }
      return next;
    });
  }, [columnsByPath]);

  const handleAddFiles = useCallback(async (paths) => {
    let candidatePaths = paths;
    if (!candidatePaths) {
      const result = await window.electronAPI.selectInputFiles();
      if (result.canceled) return;
      candidatePaths = result.files;
    }

    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      const newPaths = candidatePaths.filter((p) => !existing.has(p));
      if (newPaths.length === 0) return prev;

      window.electronAPI.statFiles(newPaths).then((stats) => {
        const sizeByPath = new Map(stats.map((s) => [s.path, s.size]));
        setFiles((current) => {
          const known = new Set(current.map((f) => f.path));
          return current.map((f) =>
            !known.has(f.path) || f.size != null ? f : { ...f, size: sizeByPath.get(f.path) || 0 }
          );
        });
      });

      const additions = newPaths.map((p) => ({ path: p, name: pathName(p), size: null }));
      return [...prev, ...additions];
    });
  }, []);

  // Punto único de entrada para archivos soltados por arrastrar-y-soltar, tanto en la zona de
  // carga (FileList) como en cualquier otro punto de la ventana (WindowDropOverlay más abajo):
  // filtra por extensión soportada y avisa (banner temporal) si se ignoró alguno.
  const handleFilesDropped = useCallback(
    (paths) => {
      const accepted = paths.filter((p) => ACCEPTED_INPUT_EXTENSIONS.has(extensionOf(p)));
      if (accepted.length > 0) handleAddFiles(accepted);

      if (accepted.length < paths.length) {
        setRejectedCount(paths.length - accepted.length);
        clearTimeout(rejectTimerRef.current);
        rejectTimerRef.current = setTimeout(() => setRejectedCount(0), 3500);
      }
    },
    [handleAddFiles]
  );

  // Captura el arrastre de archivos sobre cualquier punto de la ventana (no solo la zona de
  // carga de FileList): sin `preventDefault` en dragover, Chromium intentaría navegar a/abrir el
  // archivo soltado en vez de dejar que la app lo reciba. Se ignora mientras hay un trabajo en
  // curso, igual que la zona de carga (`disabled` en FileList).
  useEffect(() => {
    const onDragEnter = (event) => {
      if (isProcessing || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragCounterRef.current += 1;
      setIsWindowDragOver(true);
    };
    const onDragOver = (event) => {
      if (isProcessing || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
    };
    const onDragLeave = (event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsWindowDragOver(false);
    };
    const onDrop = (event) => {
      event.preventDefault();
      dragCounterRef.current = 0;
      setIsWindowDragOver(false);
      if (isProcessing || !event.dataTransfer.types.includes("Files")) return;

      const paths = Array.from(event.dataTransfer.files).map((file) =>
        window.electronAPI.getPathForFile(file)
      );
      handleFilesDropped(paths);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [isProcessing, handleFilesDropped]);

  const handleRemove = useCallback((index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleReorder = useCallback((fromIndex, toIndex) => {
    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setFiles([]);
    setProgressState("hidden");
    setResultPath(null);
  }, []);

  const handleBrowseFolder = useCallback(async () => {
    const result = await window.electronAPI.selectOutputFolder();
    if (result.canceled) return;
    setDestinationFolder(result.path);
  }, []);

  const totalSize = useMemo(() => files.reduce((sum, f) => sum + (f.size || 0), 0), [files]);

  const missingJoinKeyFiles = useMemo(
    () => (mode === "join" ? files.filter((f) => !joinKeys[f.path]) : []),
    [mode, files, joinKeys]
  );

  const canMerge =
    files.length > 0 &&
    !!destinationFolder &&
    (mode === "concat" || (files.length >= 2 && missingJoinKeyFiles.length === 0));

  // Devuelve { key, params } en vez de texto ya traducido, para que siga siendo correcto si el
  // usuario cambia de idioma mientras el botón de combinar está deshabilitado.
  const mergeBlockedReason = useMemo(() => {
    if (files.length === 0) return { key: "blocked.noFiles" };
    if (!destinationFolder) return { key: "blocked.noDestination" };
    if (mode === "join") {
      if (files.length < 2) return { key: "blocked.joinMinFiles" };
      if (loadingColumns) return { key: "blocked.readingColumns" };
      if (columnsError) return { key: null, text: columnsError };
      if (missingJoinKeyFiles.length > 0) {
        return {
          key: "blocked.chooseKeyFor",
          params: { files: missingJoinKeyFiles.map((f) => f.name).join(", ") },
        };
      }
    }
    return null;
  }, [files.length, destinationFolder, mode, loadingColumns, columnsError, missingJoinKeyFiles]);

  const handleMerge = useCallback(async () => {
    if (!canMerge) return;

    setIsProcessing(true);
    setProgressState("running");
    setProgress(0);
    setProcessedCount(null);
    setResultPath(null);
    setStatusMessage(t("status.startingMerge"));

    const safeName = sanitizeFileName(outputFileName) || "combinado";
    const outputPath = joinPath(destinationFolder, `${safeName}.${outputFormat}`);

    try {
      const joinKeysPayload = Object.fromEntries(files.map((f) => [f.path, joinKeys[f.path] || ""]));
      const { job_id: jobId } = await startMerge(
        files.map((f) => f.path),
        outputFormat,
        outputPath,
        {
          addSourceColumn,
          sourceColumnName: t("stackOptions.sourceColumnName"),
          allAsText,
          mode,
          joinKeys: joinKeysPayload,
          joinType,
          csvSeparators,
          outputCsvSeparator,
        }
      );

      const finalStatus = await pollMergeStatus(jobId, (status) => {
        setProgress(status.progress || 0);
        setStatusMessage(backendText(status, t, t("status.processing")));
        setProcessedCount(parseProcessed(status));
      });

      setProgress(100);
      setResultPath(finalStatus.result_path || outputPath);
      setProgressState("success");
    } catch (err) {
      setStatusMessage(backendText(err, t, t("status.unexpectedError")));
      setProgressState("error");
    } finally {
      setIsProcessing(false);
    }
  }, [
    canMerge,
    files,
    outputFormat,
    outputFileName,
    destinationFolder,
    addSourceColumn,
    allAsText,
    mode,
    joinKeys,
    joinType,
    csvSeparators,
    outputCsvSeparator,
    t,
  ]);

  return (
    <>
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <svg
              className="brand-logo"
              width="26"
              height="26"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <line
                x1="6"
                y1="6"
                x2="16"
                y2="23"
                stroke="var(--accent)"
                strokeWidth="4.4"
                strokeLinecap="round"
              />
              <line
                x1="26"
                y1="6"
                x2="16"
                y2="23"
                stroke="var(--accent)"
                strokeWidth="4.4"
                strokeLinecap="round"
              />
              <path d="M9,21 L23,21 L16,30 Z" fill="var(--accent)" />
            </svg>
            <span className="brand-name">{t("header.brand")}</span>
          </div>
          <div className="header-actions">
            <LanguageToggle language={language} onChange={handleLanguageChange} />
            <ThemeToggle theme={theme} onChange={handleThemeChange} />
            <AboutDialog />
          </div>
        </header>

        {backendError && <ErrorBanner message={backendError} onDismiss={() => setBackendError(null)} />}

        <main className="app-main">
          <section className="panel panel-input">
            <h2 className="panel-title">{t("panels.input.title")}</h2>
            <FileList
              files={files}
              onAddFiles={handleAddFiles}
              onFilesDropped={handleFilesDropped}
              rejectedCount={rejectedCount}
              onRemove={handleRemove}
              onReorder={handleReorder}
              csvInfoByPath={csvInfoByPath}
              csvSeparators={csvSeparators}
              onCsvSeparatorChange={handleCsvSeparatorChange}
              disabled={isProcessing}
            />
          </section>

          <section className="panel panel-output">
            <h2 className="panel-title">{t("panels.output.title")}</h2>

            <div className="field-group">
              <label className="field-label">{t("mode.label")}</label>
              <div className="mode-toggle">
                <button
                  type="button"
                  className={`mode-toggle-btn ${mode === "join" ? "selected" : ""}`}
                  disabled={isProcessing}
                  onClick={() => setMode("join")}
                >
                  {t("mode.join.label")}
                  <span className="mode-toggle-hint">{t("mode.join.hint")}</span>
                </button>
                <button
                  type="button"
                  className={`mode-toggle-btn ${mode === "concat" ? "selected" : ""}`}
                  disabled={isProcessing}
                  onClick={() => setMode("concat")}
                >
                  {t("mode.concat.label")}
                  <span className="mode-toggle-hint">{t("mode.concat.hint")}</span>
                </button>
              </div>
            </div>

            {mode === "join" && (
              <div className="field-group">
                <JoinPicker
                  joinType={joinType}
                  onJoinTypeChange={setJoinType}
                  files={files}
                  columnsByPath={columnsByPath}
                  joinKeys={joinKeys}
                  onJoinKeyChange={(path, value) => setJoinKeys((prev) => ({ ...prev, [path]: value }))}
                  loadingColumns={loadingColumns}
                  columnsError={columnsError}
                  disabled={isProcessing}
                />
              </div>
            )}

            <div className="field-group">
              <label className="field-label">{t("format.label")}</label>
              <FormatPicker value={outputFormat} onChange={setOutputFormat} disabled={isProcessing} />
            </div>

            {outputFormat === "csv" && (
              <div className="field-group">
                <label className="field-label">{t("outputCsvSeparator.label")}</label>
                <div className="format-picker" role="radiogroup" aria-label={t("outputCsvSeparator.label")}>
                  {[
                    { value: ",", labelKey: "outputCsvSeparator.comma" },
                    { value: ";", labelKey: "outputCsvSeparator.semicolon" },
                  ].map((option) => {
                    const selected = outputCsvSeparator === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`format-pill ${selected ? "selected" : ""}`}
                        disabled={isProcessing}
                        onClick={() => setOutputCsvSeparator(option.value)}
                      >
                        {t(option.labelKey)}
                      </button>
                    );
                  })}
                </div>
                <p className="field-hint">{t("outputCsvSeparator.hint")}</p>
              </div>
            )}

            <div className="field-group">
              <label className="field-label" htmlFor="output-filename">
                {t("outputFileName.label")}
              </label>
              <div className="destination-row">
                <input
                  id="output-filename"
                  type="text"
                  className="destination-input"
                  value={outputFileName}
                  disabled={isProcessing}
                  placeholder={t("outputFileName.placeholder")}
                  onChange={(e) => setOutputFileName(e.target.value)}
                />
                <span className="filename-extension">.{outputFormat}</span>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="destination-path">
                {t("destination.label")}
              </label>
              <div className="destination-row">
                <input
                  id="destination-path"
                  type="text"
                  className="destination-input"
                  readOnly
                  value={destinationFolder}
                  placeholder={t("destination.placeholder")}
                />
                <button type="button" className="btn" disabled={isProcessing} onClick={handleBrowseFolder}>
                  {t("destination.browse")}
                </button>
              </div>
            </div>

            <div className="field-group">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={allAsText}
                  disabled={isProcessing}
                  onChange={(e) => setAllAsText(e.target.checked)}
                />
                {t("readOptions.allAsText")}
              </label>
            </div>

            {mode === "concat" && (
              <div className="field-group">
                <div className="field-row">
                  <span className="field-label field-label--inline">{t("stackOptions.label")}</span>
                  <StackTutorial />
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={addSourceColumn}
                    disabled={isProcessing}
                    onChange={(e) => setAddSourceColumn(e.target.checked)}
                  />
                  {t("stackOptions.sourceColumn")}
                </label>
              </div>
            )}
          </section>
        </main>

        <ProgressBar
          state={progressState}
          progress={progress}
          message={statusMessage}
          processed={processedCount}
          total={files.length}
          resultPath={resultPath}
          onOpenFolder={(p) => window.electronAPI.openContainingFolder(p)}
        />

        <footer className="app-footer">
          {!isProcessing && !canMerge && mergeBlockedReason && (
            <p className="footer-blocked-hint">
              {mergeBlockedReason.key
                ? t(mergeBlockedReason.key, mergeBlockedReason.params)
                : mergeBlockedReason.text}
            </p>
          )}
          <div className="footer-row">
            <div className="footer-actions">
              <button
                type="button"
                className="btn primary"
                disabled={isProcessing || !canMerge}
                onClick={handleMerge}
              >
                {isProcessing ? t("footer.processing") : t("footer.mergeButton")}
              </button>
              <button
                type="button"
                className="btn subtle"
                disabled={isProcessing || files.length === 0}
                onClick={handleClearAll}
              >
                {t("footer.clear")}
              </button>
            </div>
            <div className="footer-summary">
              {t("footer.summary", { count: files.length, size: formatBytes(totalSize) })}
            </div>
          </div>
        </footer>
      </div>
      <OnboardingTour active={showTour} onFinish={() => setShowTour(false)} />
      <WindowDropOverlay active={isWindowDragOver} />
    </>
  );
}
