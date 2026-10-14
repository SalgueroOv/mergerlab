/**
 * Cliente HTTP del backend Python (`backend/server.py`). El backend elige un puerto libre en
 * 127.0.0.1 al arrancar; Electron lo captura de su stdout y lo expone al renderer a través de
 * `window.electronAPI.getBackendPort()` (ver `electron/preload.js` y `electron/main.js`), así
 * que este módulo no conoce el puerto de antemano y lo resuelve la primera vez que hace falta.
 */
import i18n from "./i18n/index.js";

let cachedBase = null;
let cachedToken = null;

/**
 * Resuelve (y cachea) la URL base del backend, p. ej. `"http://127.0.0.1:53210"`.
 * @returns {Promise<string>}
 */
async function getApiBase() {
  if (cachedBase) return cachedBase;

  const { port, token, error } = await window.electronAPI.getBackendPort();
  if (error || !port || !token) {
    throw new Error(error || i18n.t("errors.backendUnavailable"));
  }
  cachedToken = token;
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
  // El backend exige el token secreto de esta ejecución en cada petición (ver server.py).
  const headers = { ...options?.headers, "X-Auth-Token": cachedToken };
  const response = await fetch(url, { ...options, headers });
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
 * @param {boolean} [options.addSourceColumn] solo aplica en modo `"concat"`
 * @param {string} [options.sourceColumnName] nombre de esa columna (traducido al idioma de la app)
 * @param {Record<string,string>} [options.sheets] `{ruta: hoja}` elegida para algunos Excel
 * @param {boolean} [options.allAsText] leer todas las columnas como texto (ceros a la izquierda)
 * @param {boolean} [options.removeDuplicates] quitar del resultado final las filas repetidas (en
 *   ambos modos; al apilar se ignora la columna de archivo de origen al comparar). El estado final
 *   informa de cuántas se quitaron en `params.duplicatesRemoved`
 * @param {"concat"|"join"} [options.mode]
 * @param {Record<string,string>} [options.joinKeys] `{ruta: columnaClave}`, solo en modo `"join"`
 * @param {string} [options.joinType] `"inner" | "left" | "right" | "outer" | "left_anti" |
 *   "right_anti"`, solo en modo `"join"` (`"right_anti"` exige exactamente dos archivos)
 * @param {Record<string,string>} [options.csvSeparators] `{ruta: separador}` elegido a mano para
 *   algunos CSV; los que no aparecen se detectan automáticamente en el backend
 * @param {string} [options.outputCsvSeparator] `"," | ";"`, solo aplica si `outputFormat` es `"csv"`
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
      add_source_column: options.addSourceColumn ?? false,
      source_column_name: options.sourceColumnName,
      all_as_text: options.allAsText ?? false,
      remove_duplicates: options.removeDuplicates ?? false,
      sheets: options.sheets ?? {},
      mode: options.mode ?? "concat",
      join_keys: options.joinKeys ?? {},
      join_type: options.joinType,
      csv_separators: options.csvSeparators ?? {},
      output_csv_separator: options.outputCsvSeparator ?? ",",
    }),
  });
}

/**
 * Pide al backend las columnas de cada archivo indicado (`POST /api/columns`), para poblar los
 * selectores de columna clave del modo join.
 * @param {string[]} files rutas absolutas de los archivos
 * @param {Record<string,string>} [csvSeparators] `{ruta: separador}` elegido a mano para algunos CSV
 * @param {Record<string,string>} [sheets] `{ruta: hoja}` elegida para algunos Excel (sin entrada = todas)
 * @returns {Promise<Record<string, string[]>>} `{ruta: [nombreColumna, ...]}`
 */
export async function getColumns(files, csvSeparators = {}, sheets = {}) {
  const base = await getApiBase();
  const { columns } = await requestJson(`${base}/api/columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, csv_separators: csvSeparators, sheets }),
  });
  return columns;
}

/**
 * Pide al backend los nombres de las hojas de cada archivo (`POST /api/sheets`), para el selector
 * de hoja de los Excel con varias.
 * @param {string[]} files rutas absolutas de los archivos
 * @returns {Promise<Record<string, string[]>>} `{ruta: [hoja, ...]}`; los `.csv` llevan lista vacía
 */
export async function getSheets(files) {
  const base = await getApiBase();
  const { sheets } = await requestJson(`${base}/api/sheets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  return sheets;
}

/**
 * Pide al backend cómo va a leer cada CSV indicado (`POST /api/inspect-csv`): separador,
 * codificación, si la detección automática está segura y una vista previa de las primeras filas.
 * @param {string[]} files rutas absolutas de archivos `.csv`
 * @param {Record<string,string>} [csvSeparators] `{ruta: separador}` elegido a mano para algunos CSV
 * @returns {Promise<Record<string, {separator: string, encoding: string, confident: boolean,
 *   columns: string[], rows: string[][]} | {error: {message: string, code?: string, params?: object}}>>}
 *   `{ruta: info}`; si un archivo concreto no se pudo leer, su `info` es `{error}`
 */
export async function inspectCsv(files, csvSeparators = {}) {
  const base = await getApiBase();
  const { csv } = await requestJson(`${base}/api/inspect-csv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, csv_separators: csvSeparators }),
  });
  return csv;
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
