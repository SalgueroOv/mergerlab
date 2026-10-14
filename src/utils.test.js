import { describe, expect, it } from "vitest";
import es from "./i18n/locales/es.json";
import {
  buildReportLabels,
  formatBytes,
  isJoinTypeUnavailable,
  joinPath,
  normalizeColumnName,
  overwriteCheckPaths,
  parseProcessed,
  pathName,
  reportCsvPath,
  sanitizeFileName,
} from "./utils.js";

describe("pathName", () => {
  it("acepta separadores de Windows y de Unix", () => {
    expect(pathName("C:\\datos\\ventas.csv")).toBe("ventas.csv");
    expect(pathName("/home/ana/ventas.csv")).toBe("ventas.csv");
    expect(pathName("ventas.csv")).toBe("ventas.csv");
  });
});

describe("joinPath", () => {
  it("respeta el separador de la carpeta y no lo duplica", () => {
    expect(joinPath("C:\\datos", "a.csv")).toBe("C:\\datos\\a.csv");
    expect(joinPath("C:\\datos\\", "a.csv")).toBe("C:\\datos\\a.csv");
    expect(joinPath("/home/ana", "a.csv")).toBe("/home/ana/a.csv");
    expect(joinPath("", "a.csv")).toBe("a.csv");
  });
});

describe("sanitizeFileName", () => {
  it("quita los caracteres no válidos en Windows", () => {
    expect(sanitizeFileName(' in<for>me:"1"?*|/\\ ')).toBe("informe1");
  });
});

describe("formatBytes", () => {
  it("elige la unidad adecuada", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("parseProcessed", () => {
  it("prioriza params.index y cae al texto como respaldo", () => {
    expect(parseProcessed({ params: { index: 3 }, message: "Leído a.csv (1/5)" })).toBe(3);
    expect(parseProcessed({ message: "Leído a.csv (2/5)" })).toBe(2);
    expect(parseProcessed({ message: "Guardando" })).toBeNull();
    expect(parseProcessed(null)).toBeNull();
  });
});

describe("isJoinTypeUnavailable", () => {
  it("solo bloquea right_anti con más de dos archivos", () => {
    expect(isJoinTypeUnavailable("right_anti", 2)).toBe(false);
    expect(isJoinTypeUnavailable("right_anti", 3)).toBe(true);
    expect(isJoinTypeUnavailable("left_anti", 5)).toBe(false);
    expect(isJoinTypeUnavailable("inner", 5)).toBe(false);
  });
});

describe("normalizeColumnName", () => {
  it("ignora mayúsculas, acentos y separadores", () => {
    expect(normalizeColumnName("ID Cliente")).toBe("idcliente");
    expect(normalizeColumnName("id_cliente")).toBe("idcliente");
    expect(normalizeColumnName("Código-Cliente")).toBe("codigocliente");
  });

  it("no iguala nombres genuinamente distintos", () => {
    expect(normalizeColumnName("ID_Cliente")).not.toBe(normalizeColumnName("Codigo Cliente"));
  });
});

describe("reportCsvPath", () => {
  it("pone el sufijo antes de la extensión, en la misma carpeta", () => {
    expect(reportCsvPath("C:\\datos\\combinado.csv", "informe")).toBe("C:\\datos\\combinado_informe.csv");
    expect(reportCsvPath("/home/ana/v1.2/salida.csv", "report")).toBe("/home/ana/v1.2/salida_report.csv");
  });

  it("limpia el sufijo como el backend y usa 'informe' si queda vacío", () => {
    expect(reportCsvPath("/x/datos.csv", ' in<for>me:"1"?*| ')).toBe("/x/datos_informe1.csv");
    expect(reportCsvPath("/x/datos.csv", "?*")).toBe("/x/datos_informe.csv");
    expect(reportCsvPath("/x/datos.csv", undefined)).toBe("/x/datos_informe.csv");
  });
});

describe("overwriteCheckPaths", () => {
  it("añade el archivo del informe solo en CSV con el informe activado", () => {
    expect(overwriteCheckPaths("/x/a.csv", "csv", true, "report")).toEqual(["/x/a.csv", "/x/a_report.csv"]);
    expect(overwriteCheckPaths("/x/a.csv", "csv", false, "report")).toEqual(["/x/a.csv"]);
    expect(overwriteCheckPaths("/x/a.xlsx", "xlsx", true, "report")).toEqual(["/x/a.xlsx"]);
    expect(overwriteCheckPaths("/x/a.ods", "ods", true, "report")).toEqual(["/x/a.ods"]);
  });
});

describe("buildReportLabels", () => {
  // t mínimo que busca la clave en es.json; si no existe devuelve una marca reconocible.
  const t = (key) =>
    key.split(".").reduce((node, part) => (node ? node[part] : undefined), es) ?? `FALTA:${key}`;

  it("todas las etiquetas existen en los locales", () => {
    const labels = buildReportLabels(t);
    const missing = Object.entries(labels).filter(
      ([, value]) => typeof value !== "string" || value.startsWith("FALTA:")
    );
    expect(missing).toEqual([]);
    expect(labels.sheetName).toBe("Informe");
    expect(labels.joinLeftAnti).toBe(es.joinTutorial.types.left_anti.title);
  });
});
