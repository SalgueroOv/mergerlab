import { beforeAll, describe, expect, it } from "vitest";
import i18next from "i18next";
import es from "./locales/es.json";
import en from "./locales/en.json";
import { backendText } from "./backendMessages.js";

beforeAll(async () => {
  await i18next.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: "en",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
});

const t = (...args) => i18next.t(...args);

describe("backendText", () => {
  it("traduce un código conocido con sus parámetros", () => {
    const text = backendText(
      { code: "output_extension_mismatch", params: { ext: ".bat", expected: ".csv" } },
      t
    );
    expect(text).toContain(".bat");
    expect(text).toContain(".csv");
    expect(text).not.toContain("backend.");
  });

  it("usa message si el código no se reconoce", () => {
    expect(backendText({ code: "codigo_inventado", message: "Texto de respaldo" }, t)).toBe(
      "Texto de respaldo"
    );
  });

  it("usa message si no hay código", () => {
    expect(backendText({ message: "Solo mensaje" }, t)).toBe("Solo mensaje");
  });

  it("devuelve el fallback si no hay nada", () => {
    expect(backendText(null, t, "por defecto")).toBe("por defecto");
    expect(backendText({}, t, "por defecto")).toBe("por defecto");
  });

  it("tiene traducción de los errores de seguridad y de hojas", () => {
    for (const code of ["unauthorized", "output_extension_mismatch", "sheet_not_found", "xlsx_row_limit"]) {
      expect(i18next.exists(`backend.${code}`)).toBe(true);
    }
  });
});
