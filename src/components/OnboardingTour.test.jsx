// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import es from "../i18n/locales/es.json";
import OnboardingTour from "./OnboardingTour.jsx";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    resources: { es: { translation: es } },
    lng: "es",
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderTour() {
  return render(
    <I18nextProvider i18n={i18next}>
      <OnboardingTour active onFinish={() => {}} />
    </I18nextProvider>
  );
}

/** Recorre el tour entero con la flecha derecha y devuelve el título de cada paso, en orden. */
function collectStepTitles() {
  const total = Number(screen.getByText(/^Paso 1 de \d+$/).textContent.match(/de (\d+)$/)[1]);
  const titles = [];
  for (let i = 0; i < total; i += 1) {
    titles.push(screen.getByRole("heading", { level: 3 }).textContent);
    if (i < total - 1) fireEvent.keyDown(window, { key: "ArrowRight" });
  }
  return titles;
}

describe("OnboardingTour", () => {
  it("el paso de las opciones generales va justo antes del de combinar", () => {
    renderTour();

    const titles = collectStepTitles();
    const optionsIndex = titles.indexOf(es.tour.steps.options.title);
    expect(optionsIndex).toBeGreaterThan(-1);
    expect(titles[optionsIndex + 1]).toBe(es.tour.steps.merge.title);
  });

  it("resalta el grupo de opciones generales cuando está en la pantalla", () => {
    const group = document.createElement("div");
    group.className = "general-options-group";
    document.body.appendChild(group);
    renderTour();

    const optionsIndex = collectStepTitles().indexOf(es.tour.steps.options.title);
    cleanup();
    renderTour();
    for (let i = 0; i < optionsIndex; i += 1) fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(es.tour.steps.options.title);
    expect(document.querySelector(".tour-highlight")).toBeTruthy();
  });

  it("los títulos de los pasos numerados siguen el orden del recorrido", () => {
    renderTour();

    const numbers = collectStepTitles()
      .map((title) => title.match(/^(\d+)\. /))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});
