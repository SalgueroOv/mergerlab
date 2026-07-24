/**
 * Metadatos visuales de los formatos de hoja de cálculo soportados, compartidos entre
 * `FormatPicker` (selector de formato de salida) y `FileList` (insignia de color por archivo
 * de entrada). Las etiquetas y colores no dependen del idioma, así que no pasan por i18next.
 */

/** Orden en el que se muestran los formatos en `FormatPicker`. */
export const FORMAT_ORDER = ["xlsx", "xls", "csv", "ods"];

/** Etiqueta y color de insignia por extensión (sin el punto). */
export const FORMAT_META = {
  xlsx: { label: "XLSX", color: "#16a34a" },
  xls: { label: "XLS", color: "#ea580c" },
  csv: { label: "CSV", color: "#2563eb" },
  ods: { label: "ODS", color: "#ca8a04" },
};

/**
 * Extrae la extensión de un nombre de archivo, en minúsculas y sin el punto.
 * @param {string} name
 * @returns {string} p. ej. `"xlsx"`, o `""` si `name` no tiene extensión
 */
export function extensionOf(name) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

/**
 * Devuelve los metadatos de `FORMAT_META` para una extensión, con un color/etiqueta neutros de
 * respaldo si la extensión no está en la lista soportada (no debería ocurrir en la práctica, ya
 * que `FileList` ya filtra por extensión antes de mostrar cada archivo, pero evita un `undefined`
 * si alguna vez llega una).
 * @param {string} extension
 * @returns {{label: string, color: string}}
 */
export function formatMetaFor(extension) {
  return FORMAT_META[extension] || { label: extension ? extension.toUpperCase() : "?", color: "#6b7280" };
}
