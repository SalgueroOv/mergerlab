// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import es from "../i18n/locales/es.json";
import ProgressBar from "./ProgressBar.jsx";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    resources: { es: { translation: es } },
    lng: "es",
    interpolation: { escapeValue: false },
  });
});

afterEach(cleanup);

function renderBar(props) {
  return render(
    <I18nextProvider i18n={i18next}>
      <ProgressBar progress={100} message="" processed={null} total={2} resultPath="salida.csv" {...props} />
    </I18nextProvider>
  );
}

describe("ProgressBar", () => {
  it("muestra la nota final junto a la ruta del resultado", () => {
    renderBar({ state: "success", note: "Combinación completada. Se quitaron 3 filas duplicadas." });

    expect(screen.getByText("salida.csv")).toBeTruthy();
    expect(screen.getByText("Combinación completada. Se quitaron 3 filas duplicadas.")).toBeTruthy();
  });

  it("no muestra nota si no hay", () => {
    const { container } = renderBar({ state: "success", note: null });

    expect(container.querySelector(".progress-note")).toBeNull();
  });
});
