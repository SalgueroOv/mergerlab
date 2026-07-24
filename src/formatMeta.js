export const FORMAT_ORDER = ["xlsx", "xls", "csv", "ods"];

export const FORMAT_META = {
  xlsx: { label: "XLSX", color: "#16a34a" },
  xls: { label: "XLS", color: "#ea580c" },
  csv: { label: "CSV", color: "#2563eb" },
  ods: { label: "ODS", color: "#ca8a04" },
};

export function extensionOf(name) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function formatMetaFor(extension) {
  return FORMAT_META[extension] || { label: extension ? extension.toUpperCase() : "?", color: "#6b7280" };
}
