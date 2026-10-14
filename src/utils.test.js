import { describe, expect, it } from "vitest";
import {
  formatBytes,
  isJoinTypeUnavailable,
  joinPath,
  normalizeColumnName,
  parseProcessed,
  pathName,
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
