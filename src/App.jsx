import React, { useCallback, useEffect, useMemo, useState } from "react";
import FileList from "./components/FileList.jsx";
import FormatPicker from "./components/FormatPicker.jsx";
import JoinPicker from "./components/JoinPicker.jsx";
import StackTutorial from "./components/StackTutorial.jsx";
import ProgressBar from "./components/ProgressBar.jsx";
import ErrorBanner from "./components/ErrorBanner.jsx";
import AboutDialog from "./components/AboutDialog.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";
import OnboardingTour, { hasSeenOnboarding } from "./components/OnboardingTour.jsx";
import { startMerge, pollMergeStatus, getColumns } from "./api.js";

function pathName(fullPath) {
  const normalized = fullPath.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function joinPath(folder, filename) {
  if (!folder) return filename;
  const sep = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return /[\\/]$/.test(folder) ? `${folder}${filename}` : `${folder}${sep}${filename}`;
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "").trim();
}

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

function parseProcessed(message) {
  const match = /\((\d+)\/(\d+)\)/.exec(message || "");
  return match ? Number(match[1]) : null;
}

// Compara nombres de columna ignorando mayúsculas, acentos, espacios y guiones/guiones bajos,
// para sugerir por defecto columnas que solo difieren "cosméticamente" entre archivos
// (ej. "ID Cliente" / "id_cliente"). Nombres genuinamente distintos ("ID_Cliente" vs
// "Codigo Cliente") no matchean y quedan a elección manual del usuario.
const DIACRITICS_RE = /\p{Diacritic}/gu;

function normalizeColumnName(name) {
  return String(name)
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState("join");
  const [outputFormat, setOutputFormat] = useState("xlsx");
  const [outputFileName, setOutputFileName] = useState("combinado");
  const [destinationFolder, setDestinationFolder] = useState("");
  const [includeHeadersOnce, setIncludeHeadersOnce] = useState(true);
  const [addSourceColumn, setAddSourceColumn] = useState(false);

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

  useEffect(() => {
    const unsubscribe = window.electronAPI.onBackendError((message) => {
      setBackendError(message);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    window.electronAPI.getTheme().then(setTheme);
  }, []);

  const handleThemeChange = useCallback((value) => {
    setTheme(value);
    window.electronAPI.setTheme(value);
  }, []);

  useEffect(() => {
    if (!hasSeenOnboarding()) setShowTour(true);
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onReplayOnboarding(() => setShowTour(true));
    return unsubscribe;
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

    getColumns(files.map((f) => f.path))
      .then((result) => {
        if (cancelled) return;
        setColumnsByPath(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setColumnsError(err.message || "No se pudieron leer las columnas de los archivos.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingColumns(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, files]);

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

  const mergeBlockedReason = useMemo(() => {
    if (files.length === 0) return "Añade al menos un archivo para combinar.";
    if (!destinationFolder) return "Elige una carpeta de destino para guardar el resultado.";
    if (mode === "join") {
      if (files.length < 2) return "Se necesitan al menos dos archivos para hacer un join.";
      if (loadingColumns) return "Leyendo columnas de los archivos...";
      if (columnsError) return columnsError;
      if (missingJoinKeyFiles.length > 0) {
        return `Elige la columna clave para: ${missingJoinKeyFiles.map((f) => f.name).join(", ")}.`;
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
    setStatusMessage("Iniciando combinación...");

    const safeName = sanitizeFileName(outputFileName) || "combinado";
    const outputPath = joinPath(destinationFolder, `${safeName}.${outputFormat}`);

    try {
      const joinKeysPayload = Object.fromEntries(files.map((f) => [f.path, joinKeys[f.path] || ""]));
      const { job_id: jobId } = await startMerge(
        files.map((f) => f.path),
        outputFormat,
        outputPath,
        { includeHeadersOnce, addSourceColumn, mode, joinKeys: joinKeysPayload, joinType }
      );

      const finalStatus = await pollMergeStatus(jobId, (status) => {
        setProgress(status.progress || 0);
        setStatusMessage(status.message || "Procesando...");
        setProcessedCount(parseProcessed(status.message));
      });

      setProgress(100);
      setResultPath(finalStatus.result_path || outputPath);
      setProgressState("success");
    } catch (err) {
      setStatusMessage(err.message || "Ocurrió un error inesperado al combinar los archivos.");
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
    includeHeadersOnce,
    addSourceColumn,
    mode,
    joinKeys,
    joinType,
  ]);

  return (
    <>
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <svg className="brand-logo" width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <line x1="6" y1="6" x2="16" y2="23" stroke="var(--accent)" strokeWidth="4.4" strokeLinecap="round" />
            <line x1="26" y1="6" x2="16" y2="23" stroke="var(--accent)" strokeWidth="4.4" strokeLinecap="round" />
            <path d="M9,21 L23,21 L16,30 Z" fill="var(--accent)" />
          </svg>
          <span className="brand-name">Merger Lab</span>
        </div>
        <div className="header-actions">
          <ThemeToggle theme={theme} onChange={handleThemeChange} />
          <AboutDialog />
        </div>
      </header>

      {backendError && <ErrorBanner message={backendError} onDismiss={() => setBackendError(null)} />}

      <main className="app-main">
        <section className="panel panel-input">
          <h2 className="panel-title">Archivos de entrada</h2>
          <FileList
            files={files}
            onAddFiles={handleAddFiles}
            onRemove={handleRemove}
            onReorder={handleReorder}
            disabled={isProcessing}
          />
        </section>

        <section className="panel panel-output">
          <h2 className="panel-title">Configuración de salida</h2>

          <div className="field-group">
            <label className="field-label">Modo de combinación</label>
            <div className="mode-toggle">
              <button
                type="button"
                className={`mode-toggle-btn ${mode === "join" ? "selected" : ""}`}
                disabled={isProcessing}
                onClick={() => setMode("join")}
              >
                Combinar por clave (join)
                <span className="mode-toggle-hint">une columnas de distintos archivos usando un ID en común</span>
              </button>
              <button
                type="button"
                className={`mode-toggle-btn ${mode === "concat" ? "selected" : ""}`}
                disabled={isProcessing}
                onClick={() => setMode("concat")}
              >
                Apilar filas
                <span className="mode-toggle-hint">une archivos con las mismas columnas, uno debajo del otro</span>
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
            <label className="field-label">Formato de salida</label>
            <FormatPicker value={outputFormat} onChange={setOutputFormat} disabled={isProcessing} />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="output-filename">
              Nombre del archivo de salida
            </label>
            <div className="destination-row">
              <input
                id="output-filename"
                type="text"
                className="destination-input"
                value={outputFileName}
                disabled={isProcessing}
                placeholder="combinado"
                onChange={(e) => setOutputFileName(e.target.value)}
              />
              <span className="filename-extension">.{outputFormat}</span>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="destination-path">
              Ruta de destino
            </label>
            <div className="destination-row">
              <input
                id="destination-path"
                type="text"
                className="destination-input"
                readOnly
                value={destinationFolder}
                placeholder="Selecciona una carpeta de destino..."
              />
              <button type="button" className="btn" disabled={isProcessing} onClick={handleBrowseFolder}>
                Examinar...
              </button>
            </div>
          </div>

          {mode === "concat" && (
            <div className="field-group">
              <div className="field-row">
                <span className="field-label field-label--inline">Opciones</span>
                <StackTutorial />
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={includeHeadersOnce}
                  disabled={isProcessing}
                  onChange={(e) => setIncludeHeadersOnce(e.target.checked)}
                />
                Incluir encabezados solo una vez
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={addSourceColumn}
                  disabled={isProcessing}
                  onChange={(e) => setAddSourceColumn(e.target.checked)}
                />
                Añadir columna con nombre de archivo origen
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
          <p className="footer-blocked-hint">{mergeBlockedReason}</p>
        )}
        <div className="footer-row">
          <div className="footer-actions">
            <button type="button" className="btn primary" disabled={isProcessing || !canMerge} onClick={handleMerge}>
              {isProcessing ? "Procesando..." : "Combinar archivos"}
            </button>
            <button
              type="button"
              className="btn subtle"
              disabled={isProcessing || files.length === 0}
              onClick={handleClearAll}
            >
              Limpiar
            </button>
          </div>
          <div className="footer-summary">
            {files.length} archivo{files.length === 1 ? "" : "s"} cargado{files.length === 1 ? "" : "s"} · ~
            {formatBytes(totalSize)}
          </div>
        </div>
      </footer>
    </div>
    <OnboardingTour active={showTour} onFinish={() => setShowTour(false)} />
    </>
  );
}
