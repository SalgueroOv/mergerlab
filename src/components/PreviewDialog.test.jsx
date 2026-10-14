// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import es from "../i18n/locales/es.json";
import PreviewDialog from "./PreviewDialog.jsx";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    resources: { es: { translation: es } },
    lng: "es",
    interpolation: { escapeValue: false },
  });
});

afterEach(cleanup);

function concatPreview({ rowCount, resultRows, removeDuplicates = false, duplicatesRemoved = 0 }) {
  return {
    columns: ["id", "nombre"],
    rows: Array.from({ length: rowCount }, (_, i) => [String(i), `N${i}`]),
    stats: {
      mode: "concat",
      joinType: null,
      files: [
        { name: "a.csv", sheet: null, rowsRead: 30 },
        { name: "libro.xlsx", sheet: "Dos", rowsRead: 5 },
      ],
      resultRows,
      resultColumns: 2,
      duplicatesRemoved,
      options: { addSourceColumn: false, allAsText: false, removeDuplicates },
    },
  };
}

function renderDialog(preview, onClose = () => {}) {
  return render(
    <I18nextProvider i18n={i18next}>
      <PreviewDialog preview={preview} onClose={onClose} />
    </I18nextProvider>
  );
}

/** Lee una tabla como lista de filas de texto (encabezados incluidos). */
function tableText(table) {
  return within(table)
    .getAllByRole("row")
    .map((row) => Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent));
}

/** Devuelve `{etiqueta: valor}` de los totales. */
function totals() {
  return Object.fromEntries(
    Array.from(document.querySelectorAll(".preview-total")).map((item) => [
      item.querySelector("dt").textContent,
      item.querySelector("dd").textContent,
    ])
  );
}

describe("PreviewDialog", () => {
  it("muestra los totales y oculta las duplicadas si la opción está desactivada", () => {
    renderDialog(concatPreview({ rowCount: 20, resultRows: 35 }));

    expect(screen.getByRole("dialog", { name: "Vista previa del resultado" })).toBeTruthy();
    expect(totals()).toEqual({ "Filas del resultado": "35", "Columnas del resultado": "2" });
  });

  it("muestra las duplicadas quitadas si la opción está activada", () => {
    renderDialog(concatPreview({ rowCount: 3, resultRows: 3, removeDuplicates: true, duplicatesRemoved: 2 }));

    expect(totals()).toEqual({
      "Filas del resultado": "3",
      "Columnas del resultado": "2",
      "Filas duplicadas quitadas": "2",
    });
  });

  it("al apilar, la tabla por archivo muestra archivo, hoja ('Todas' si es null) y filas leídas", () => {
    renderDialog(concatPreview({ rowCount: 20, resultRows: 35 }));

    expect(tableText(screen.getByRole("table", { name: "Archivos leídos" }))).toEqual([
      ["Archivo", "Hoja", "Filas leídas"],
      ["a.csv", "Todas", "30"],
      ["libro.xlsx", "Dos", "5"],
    ]);
  });

  it("en join, la tabla por archivo añade clave, filas sin coincidencia y con clave vacía", () => {
    renderDialog({
      columns: ["dni", "nombre", "ciudad"],
      rows: [["001", "Ana", "Lima"]],
      stats: {
        mode: "join",
        joinType: "left",
        files: [
          { name: "a.csv", sheet: null, rowsRead: 3, keyColumn: "dni", unmatchedRows: 1, emptyKeyRows: 1 },
          {
            name: "b.csv",
            sheet: null,
            rowsRead: 2,
            keyColumn: "documento",
            unmatchedRows: 0,
            emptyKeyRows: 0,
          },
        ],
        resultRows: 1,
        resultColumns: 3,
        duplicatesRemoved: 0,
        options: { addSourceColumn: false, allAsText: false, removeDuplicates: false },
      },
    });

    expect(tableText(screen.getByRole("table", { name: "Archivos leídos" }))).toEqual([
      ["Archivo", "Hoja", "Filas leídas", "Columna clave", "Filas sin coincidencia", "Filas con clave vacía"],
      ["a.csv", "Todas", "3", "dni", "1", "1"],
      ["b.csv", "Todas", "2", "documento", "0", "0"],
    ]);
    expect(screen.getByText("Mostrando 1 fila")).toBeTruthy();
  });

  it("muestra las primeras filas con sus encabezados y la nota 'Mostrando 20 de N filas'", () => {
    renderDialog(concatPreview({ rowCount: 20, resultRows: 35 }));

    const rows = tableText(screen.getByRole("table", { name: "Primeras filas del resultado" }));
    expect(rows[0]).toEqual(["id", "nombre"]);
    expect(rows).toHaveLength(21);
    expect(rows[20]).toEqual(["19", "N19"]);
    expect(screen.getByText("Mostrando 20 de 35 filas")).toBeTruthy();
  });

  it("con 20 filas o menos dice 'Mostrando N filas'", () => {
    renderDialog(concatPreview({ rowCount: 7, resultRows: 7 }));

    expect(screen.getByText("Mostrando 7 filas")).toBeTruthy();
  });

  it("con un resultado vacío lo dice en vez de mostrar la tabla", () => {
    renderDialog(concatPreview({ rowCount: 0, resultRows: 0 }));

    expect(screen.getByText("El resultado no tiene filas.")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Primeras filas del resultado" })).toBeNull();
    expect(screen.queryByText(/Mostrando/)).toBeNull();
  });

  it("se cierra con el botón y con Escape", () => {
    const onClose = vi.fn();
    renderDialog(concatPreview({ rowCount: 1, resultRows: 1 }), onClose);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
