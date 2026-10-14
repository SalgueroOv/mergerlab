import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

/**
 * Modal con la vista previa del resultado de la combinación (`POST /api/preview`, ver
 * `backend/server.py`): totales, una tabla con lo leído de cada archivo y las primeras filas del
 * resultado. Se cierra con el botón "×", con Escape o haciendo clic fuera del panel, igual que los
 * tutoriales (`StackTutorial`/`JoinTutorial`). Las etiquetas de los totales y de la tabla por
 * archivo son las mismas del informe de la combinación (`report.*`).
 * @param {{
 *   preview: {
 *     columns: string[],
 *     rows: string[][],
 *     stats: {
 *       mode: "concat"|"join",
 *       files: {name: string, sheet: string|null, rowsRead: number, keyColumn?: string,
 *         unmatchedRows?: number, emptyKeyRows?: number}[],
 *       resultRows: number,
 *       resultColumns: number,
 *       duplicatesRemoved: number,
 *       options: {removeDuplicates: boolean},
 *     },
 *   },
 *   onClose: () => void,
 * }} props
 */
export default function PreviewDialog({ preview, onClose }) {
  const { t } = useTranslation();
  const { columns, rows, stats } = preview;
  const isJoin = stats.mode === "join";

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const totals = [
    { label: t("report.resultRows"), value: stats.resultRows },
    { label: t("report.resultColumns"), value: stats.resultColumns },
  ];
  if (stats.options?.removeDuplicates) {
    totals.push({ label: t("report.duplicatesRemoved"), value: stats.duplicatesRemoved });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel modal-panel--wide"
        role="dialog"
        aria-modal="true"
        aria-label={t("preview.title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{t("preview.title")}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            ×
          </button>
        </div>

        <dl className="preview-totals">
          {totals.map(({ label, value }) => (
            <div className="preview-total" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <h4 className="preview-heading">{t("preview.filesHeading")}</h4>
        <div className="table-preview">
          <table aria-label={t("preview.filesHeading")}>
            <thead>
              <tr>
                <th>{t("report.file")}</th>
                <th>{t("report.sheet")}</th>
                <th>{t("report.rowsRead")}</th>
                {isJoin && (
                  <>
                    <th>{t("report.keyColumn")}</th>
                    <th>{t("report.unmatchedRows")}</th>
                    <th>{t("report.emptyKeyRows")}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {stats.files.map((file, index) => (
                <tr key={index}>
                  <td>{file.name}</td>
                  <td>{file.sheet ?? t("report.allSheets")}</td>
                  <td>{file.rowsRead}</td>
                  {isJoin && (
                    <>
                      <td>{file.keyColumn}</td>
                      <td>{file.unmatchedRows}</td>
                      <td>{file.emptyKeyRows}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="preview-heading">{t("preview.rowsHeading")}</h4>
        {rows.length === 0 ? (
          <p className="preview-note">{t("preview.empty")}</p>
        ) : (
          <>
            <div className="table-preview">
              <table aria-label={t("preview.rowsHeading")}>
                <thead>
                  <tr>
                    {columns.map((column, index) => (
                      <th key={index}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="preview-note">
              {stats.resultRows > rows.length
                ? t("preview.showingSome", { shown: rows.length, total: stats.resultRows })
                : t("preview.showingAll", { count: rows.length })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
