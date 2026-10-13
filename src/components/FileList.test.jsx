// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import es from "../i18n/locales/es.json";
import FileList from "./FileList.jsx";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    resources: { es: { translation: es } },
    lng: "es",
    interpolation: { escapeValue: false },
  });
});

afterEach(cleanup);

const baseProps = {
  onAddFiles: () => {},
  onFilesDropped: () => {},
  rejectedCount: 0,
  onRemove: () => {},
  onReorder: () => {},
  csvInfoByPath: {},
  csvSeparators: {},
  onCsvSeparatorChange: () => {},
  disabled: false,
};

function renderList(props) {
  return render(
    <I18nextProvider i18n={i18next}>
      <FileList {...baseProps} {...props} />
    </I18nextProvider>
  );
}

describe("FileList: selector de hoja", () => {
  const files = [{ path: "C:\\datos\\libro.xlsx", name: "libro.xlsx", size: 10 }];

  it("aparece para un Excel con varias hojas y avisa al elegir una", () => {
    const onSheetChange = vi.fn();
    renderList({
      files,
      sheetsByPath: { [files[0].path]: ["Uno", "Dos"] },
      selectedSheets: {},
      onSheetChange,
    });

    const select = screen.getByLabelText("Hoja");
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "Todas las hojas (2)" })).toBeTruthy();

    fireEvent.change(select, { target: { value: "Dos" } });
    expect(onSheetChange).toHaveBeenCalledWith(files[0].path, "Dos");
  });

  it("muestra la hoja ya elegida", () => {
    renderList({
      files,
      sheetsByPath: { [files[0].path]: ["Uno", "Dos"] },
      selectedSheets: { [files[0].path]: "Uno" },
      onSheetChange: () => {},
    });

    expect(screen.getByLabelText("Hoja").value).toBe("Uno");
  });

  it("no aparece si el Excel tiene una sola hoja", () => {
    renderList({
      files,
      sheetsByPath: { [files[0].path]: ["Unica"] },
      selectedSheets: {},
      onSheetChange: () => {},
    });

    expect(screen.queryByLabelText("Hoja")).toBeNull();
  });

  it("no aparece para un CSV", () => {
    const csv = [{ path: "C:\\datos\\a.csv", name: "a.csv", size: 10 }];
    renderList({ files: csv, sheetsByPath: {}, selectedSheets: {}, onSheetChange: () => {} });

    expect(screen.queryByLabelText("Hoja")).toBeNull();
  });
});
