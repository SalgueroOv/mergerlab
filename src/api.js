/**
 * Cliente HTTP del backend Python (`backend/server.py`). El backend elige un puerto libre en
 * 127.0.0.1 al arrancar; Electron lo captura de su stdout y lo expone al renderer a través de
 * `window.electronAPI.getBackendPort()` (ver `electron/preload.js` y `electron/main.js`), así
 * que este módulo no conoce el puerto de antemano y lo resuelve la primera vez que hace falta.
 */
import i18n from "./i18n/index.js";

let cachedBase = null;

/**
 * Resuelve (y cachea) la URL base del backend, p. ej. `"http://127.0.0.1:53210"`.
 * @returns {Promise<string>}
 */
async function getApiBase() {
  if (cachedBase) return cachedBase;

  const { port, error } = await window.electronAPI.getBackendPort();
  if (error || !port) {
    throw new Error(error || i18n.t("errors.backendUnavailable"));
  }
  cachedBase = `http://127.0.0.1:${port}`;
  return cachedBase;
}

/**
 * `fetch` + `JSON.parse` con manejo de error uniforme: si la respuesta no es 2xx, lanza un
 * `Error` cuyo `.message` es el texto en español que manda el backend (o un texto genérico si
 * la respuesta no trae cuerpo JSON), y cuyos `.code`/`.params` son la versión traducible del
 * mismo mensaje cuando el backend la incluye (ver `src/i18n/backendMessages.js`).
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>} el cuerpo de la respuesta ya parseado
 */
async function requestJson(url, options) {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON
  }

  if (!response.ok) {
    const message =
      body && body.message ? body.message : i18n.t("errors.httpError", { status: response.status });
    const error = new Error(message);
    // El backend manda `code`/`params` cuando el mensaje es traducible (ver backend/server.py);
    // se propagan en el Error para que la UI pueda traducirlo con i18n/backendMessages.js.
    error.code = body && body.code;
    error.params = body && body.params;
    throw error;
  }

  return body;
}

/**
 * Lanza un trabajo de combinación en el backend (`POST /api/merge`).
 * @param {string[]} files rutas absolutas de los archivos de entrada, en el orden a combinar
 * @param {string} outputFormat `"xlsx" | "xls" | "csv" | "ods"`
 * @param {string} outputPath ruta absoluta completa del archivo de salida
 * @param {object} [options]
 * @param {boolean} [options.includeHeadersOnce] solo aplica en modo `"concat"`
 * @param {boolean} [options.addSourceColumn] solo aplica en modo `"concat"`
 * @param {"concat"|"join"} [options.mode]
 * @param {Record<string,string>} [options.joinKeys] `{ruta: columnaClave}`, solo en modo `"join"`
 * @param {string} [options.joinType] `"inner" | "left" | "right" | "outer"`, solo en modo `"join"`
 * @returns {Promise<{job_id: string}>}
 */
export async function startMerge(files, outputFormat, outputPath, options = {}) {
  const base = await getApiBase();
  return requestJson(`${base}/api/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      output_format: outputFormat,
      output_path: outputPath,
      include_headers_once: options.includeHeadersOnce ?? true,
      add_source_column: options.addSourceColumn ?? false,
      mode: options.mode ?? "concat",
      join_keys: options.joinKeys ?? {},
      join_type: options.joinType,
    }),
  });
}

/**
 * Pide al backend las columnas de cada archivo indicado (`POST /api/columns`), para poblar los
 * selectores de columna clave del modo join.
 * @param {string[]} files rutas absolutas de los archivos
 * @returns {Promise<Record<string, string[]>>} `{ruta: [nombreColumna, ...]}`
 */
export async function getColumns(files) {
  const base = await getApiBase();
  const { columns } = await requestJson(`${base}/api/columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  return columns;
}

/**
 * Consulta una vez el estado de un trabajo de combinación (`GET /api/status/<jobId>`).
 * @param {string} jobId
 * @returns {Promise<object>} `{job_id, status, progress, message, code, params, result_path}`
 */
export async function getMergeStatus(jobId) {
  const base = await getApiBase();
  return requestJson(`${base}/api/status/${jobId}`, { method: "GET" });
}

/**
 * Sondea el estado de un trabajo de combinación hasta que finaliza (done|error).
 * @param {string} jobId
 * @param {(status: object) => void} onProgress
 * @returns {Promise<object>} estado final
 */
export async function pollMergeStatus(jobId, onProgress) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const status = await getMergeStatus(jobId);
        onProgress(status);

        if (status.status === "done") {
          resolve(status);
        } else if (status.status === "error") {
          const error = new Error(status.message || i18n.t("errors.mergeGenericError"));
          error.code = status.code;
          error.params = status.params;
          reject(error);
        } else {
          setTimeout(tick, 350);
        }
      } catch (err) {
        reject(err);
      }
    };

    tick();
  });
}
