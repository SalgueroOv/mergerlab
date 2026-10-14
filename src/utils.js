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

// Sufijo por defecto del archivo del informe CSV si el traducido queda vacío al limpiarlo; es el
// mismo respaldo que usa el backend (`DEFAULT_REPORT_LABELS["fileSuffix"]` en merger.py).
const DEFAULT_REPORT_FILE_SUFFIX = "informe";

/**
 * Ruta del archivo aparte del informe de la combinación cuando la salida es CSV:
 * `<nombre>_<sufijo>.csv`, junto al resultado. Calcula lo mismo que `report_output_path` en
 * `backend/merger.py` (que limpia el sufijo igual que `sanitizeFileName`), para poder preguntar
 * antes de sobrescribirlo.
 * @param {string} outputPath ruta del CSV principal
 * @param {string} suffix sufijo traducido (`report.fileSuffix`)
 * @returns {string}
 */
export function reportCsvPath(outputPath, suffix) {
  const cleanSuffix = sanitizeFileName(suffix || "") || DEFAULT_REPORT_FILE_SUFFIX;
  const root = outputPath.replace(/\.[^.\\/]*$/, "");
  return `${root}_${cleanSuffix}.csv`;
}

/**
 * Rutas que hay que comprobar antes de combinar, para pedir confirmación si alguna ya existe:
 * siempre el archivo de salida y, si el formato es CSV y el informe está activado, también el
 * archivo aparte del informe (en los demás formatos el informe va dentro del mismo libro).
 * @param {string} outputPath
 * @param {string} outputFormat `"xlsx" | "xls" | "csv" | "ods"`
 * @param {boolean} includeReport
 * @param {string} reportSuffix sufijo traducido del archivo del informe
 * @returns {string[]}
 */
export function overwriteCheckPaths(outputPath, outputFormat, includeReport, reportSuffix) {
  if (includeReport && outputFormat === "csv") return [outputPath, reportCsvPath(outputPath, reportSuffix)];
  return [outputPath];
}

/**
 * Textos del informe de la combinación en el idioma actual, para `report_labels` de
 * `/api/merge` (claves de `DEFAULT_REPORT_LABELS` en `backend/merger.py`). Los nombres del modo,
 * del tipo de join y de las opciones reutilizan los textos que el usuario ve en la pantalla.
 * @param {(key: string) => string} t función de traducción de i18next
 * @returns {Record<string, string>}
 */
export function buildReportLabels(t) {
  return {
    sheetName: t("report.sheetName"),
    fileSuffix: t("report.fileSuffix"),
    generatedAt: t("report.generatedAt"),
    mode: t("mode.label"),
    modeConcat: t("mode.concat.label"),
    modeJoin: t("mode.join.label"),
    joinType: t("join.typeLabel"),
    joinInner: t("joinTutorial.types.inner.title"),
    joinLeft: t("joinTutorial.types.left.title"),
    joinRight: t("joinTutorial.types.right.title"),
    joinOuter: t("joinTutorial.types.outer.title"),
    joinLeftAnti: t("joinTutorial.types.left_anti.title"),
    joinRightAnti: t("joinTutorial.types.right_anti.title"),
    resultRows: t("report.resultRows"),
    resultColumns: t("report.resultColumns"),
    duplicatesRemoved: t("report.duplicatesRemoved"),
    addSourceColumn: t("stackOptions.sourceColumn"),
    allAsText: t("readOptions.allAsText"),
    removeDuplicates: t("readOptions.removeDuplicates"),
    yes: t("report.yes"),
    no: t("report.no"),
    file: t("report.file"),
    sheet: t("report.sheet"),
    allSheets: t("report.allSheets"),
    rowsRead: t("report.rowsRead"),
    keyColumn: t("report.keyColumn"),
    unmatchedRows: t("report.unmatchedRows"),
    emptyKeyRows: t("report.emptyKeyRows"),
  };
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
