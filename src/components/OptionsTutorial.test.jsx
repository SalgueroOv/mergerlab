// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import es from "../i18n/locales/es.json";
import OptionsTutorial from "./OptionsTutorial.jsx";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    resources: { es: { translation: es } },
    lng: "es",
    interpolation: { escapeValue: false },
  });
});

afterEach(cleanup);

function renderTutorial() {
  return render(
    <I18nextProvider i18n={i18next}>
      <OptionsTutorial />
    </I18nextProvider>
  );
}

describe("OptionsTutorial", () => {
  it("empieza cerrado y el botón '?' abre el modal", () => {
    renderTutorial();

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Qué hace cada opción" }));

    expect(screen.getByRole("dialog", { name: "Opciones generales" })).toBeTruthy();
  });

  it("muestra una sección por opción y otra para la vista previa", () => {
    renderTutorial();
    fireEvent.click(screen.getByRole("button", { name: "Qué hace cada opción" }));

    const dialog = screen.getByRole("dialog", { name: "Opciones generales" });
    expect(
      within(dialog)
        .getAllByRole("heading", { level: 4 })
        .map((h) => h.textContent)
    ).toEqual([
      "Leer todas las columnas como texto",
      "Quitar filas duplicadas",
      "Incluir informe de la combinación",
      "Botón «Vista previa»",
    ]);
  });

  it("usa el nombre real de la hoja y del archivo del informe", () => {
    renderTutorial();
    fireEvent.click(screen.getByRole("button", { name: "Qué hace cada opción" }));

    const dialog = screen.getByRole("dialog", { name: "Opciones generales" });
    expect(within(dialog).getByText(/hoja adicional llamada «Informe»/)).toBeTruthy();
    expect(within(dialog).getByText(/<nombre>_informe\.csv/)).toBeTruthy();
  });

  it("se cierra con Escape y con el botón ×", () => {
    renderTutorial();
    const openButton = screen.getByRole("button", { name: "Qué hace cada opción" });

    fireEvent.click(openButton);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(openButton);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
