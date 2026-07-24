let cachedBase = null;

async function getApiBase() {
  if (cachedBase) return cachedBase;

  const { port, error } = await window.electronAPI.getBackendPort();
  if (error || !port) {
    throw new Error(error || "El backend no está disponible todavía.");
  }
  cachedBase = `http://127.0.0.1:${port}`;
  return cachedBase;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON
  }

  if (!response.ok) {
    const message = body && body.message ? body.message : `Error HTTP ${response.status}`;
    throw new Error(message);
  }

  return body;
}

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

export async function getColumns(files) {
  const base = await getApiBase();
  const { columns } = await requestJson(`${base}/api/columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  return columns;
}

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
          reject(new Error(status.message || "Ocurrió un error al combinar los archivos."));
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
