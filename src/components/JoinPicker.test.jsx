// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import es from "../i18n/locales/es.json";
import JoinPicker from "./JoinPicker.jsx";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    resources: { es: { translation: es } },
    lng: "es",
    interpolation: { escapeValue: false },
  });
});

afterEach(cleanup);

const baseProps = {
  joinType: "inner",
  onJoinTypeChange: () => {},
  columnsByPath: {},
  joinKeys: {},
  onJoinKeyChange: () => {},
  loadingColumns: false,
  columnsError: null,
  disabled: false,
};

function filesOf(count) {
  return Array.from({ length: count }, (_, i) => ({ path: `C:\\datos\\${i}.csv`, name: `${i}.csv` }));
}

function renderPicker(props) {
  return render(
    <I18nextProvider i18n={i18next}>
      <JoinPicker {...baseProps} {...props} />
    </I18nextProvider>
  );
}

describe("JoinPicker: tipos anti", () => {
  it("con dos archivos permite elegir Left anti y Right anti", () => {
    const onJoinTypeChange = vi.fn();
    renderPicker({ files: filesOf(2), onJoinTypeChange });

    const leftAnti = screen.getByRole("radio", { name: "Left anti" });
    const rightAnti = screen.getByRole("radio", { name: "Right anti" });
    expect(leftAnti.disabled).toBe(false);
    expect(rightAnti.disabled).toBe(false);
    expect(rightAnti.title).toBe(es.join.typeHints.right_anti);

    fireEvent.click(rightAnti);
    expect(onJoinTypeChange).toHaveBeenCalledWith("right_anti");
  });

  it("con tres archivos deshabilita Right anti y explica por qué", () => {
    renderPicker({ files: filesOf(3) });

    const rightAnti = screen.getByRole("radio", { name: "Right anti" });
    expect(rightAnti.disabled).toBe(true);
    expect(rightAnti.title).toBe(es.join.rightAntiTwoFiles);
    expect(screen.getByRole("radio", { name: "Left anti" }).disabled).toBe(false);
    // Sin Right anti elegido no hace falta el aviso debajo (basta el tooltip).
    expect(screen.queryByText(es.join.rightAntiTwoFiles)).toBeNull();
  });

  it("si Right anti ya estaba elegido y hay tres archivos, muestra el motivo", () => {
    renderPicker({ files: filesOf(3), joinType: "right_anti" });

    expect(screen.getByText(es.join.rightAntiTwoFiles)).toBeTruthy();
  });
});
