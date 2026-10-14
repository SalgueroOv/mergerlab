// Funciones puras de apoyo de la pantalla principal (sin React ni Electron, fáciles de testear).

/**
 * Extrae el nombre de archivo (sin carpetas) de una ruta absoluta, aceptando tanto `/` como `\`
 * como separador (los paths que llegan de Electron son nativos del SO: `\` en Windows).
 * @param {string} fullPath
 * @returns {string}
 */
export function pathName(fullPath) {
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
export function joinPath(folder, filename) {
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
export function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "").trim();
}

/**
 * Formatea un tamaño en bytes como texto legible (`"1.5 MB"`), eligiendo la unidad más grande
 * que mantenga el valor por debajo de 1024.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
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
export function parseProcessed(status) {
  if (status && status.params && typeof status.params.index === "number") {
    return status.params.index;
  }
  const match = /\((\d+)\/(\d+)\)/.exec((status && status.message) || "");
  return match ? Number(match[1]) : null;
}

/**
 * Indica si un tipo de join no se puede usar con `fileCount` archivos. Hoy solo afecta a
 * `"right_anti"` (filas del segundo archivo sin coincidencia en el primero), que exige
 * exactamente dos: con más, el backend lo rechaza (`right_anti_two_files`). Con menos de dos el
 * join entero ya está bloqueado por otro motivo, así que eso no cuenta aquí.
 * @param {string} joinType
 * @param {number} fileCount
 * @returns {boolean}
 */
export function isJoinTypeUnavailable(joinType, fileCount) {
  return joinType === "right_anti" && fileCount > 2;
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
export function normalizeColumnName(name) {
  return String(name)
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
