import React from "react";
import { useTranslation } from "react-i18next";
import JoinTutorial from "./JoinTutorial.jsx";

// Los nombres de los tipos de join (Inner/Left/Right/Outer) se mantienen sin traducir en todos
// los idiomas, igual que en el texto original: son terminología técnica universal, solo se
// traduce su explicación (ver joinTutorial.types.* en los locales).
const JOIN_TYPES = [
  { value: "inner", label: "Inner" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "outer", label: "Outer" },
];

/**
 * Configuración del modo "join": tipo de combinación (inner/left/right/outer) y, por cada
 * archivo, la columna que actúa de clave. `columnsByPath` lo calcula `App.jsx` (efecto que llama
 * a `getColumns` de `src/api.js` cada vez que cambian los archivos), no este componente.
 * @param {{
 *   joinType: string,
 *   onJoinTypeChange: (type: string) => void,
 *   files: {path: string, name: string}[],
 *   columnsByPath: Record<string, string[]>,
 *   joinKeys: Record<string, string>,
 *   onJoinKeyChange: (path: string, column: string) => void,
 *   loadingColumns: boolean,
 *   columnsError: string | null,
 *   disabled: boolean,
 * }} props
 */
export default function JoinPicker({
  joinType,
  onJoinTypeChange,
  files,
  columnsByPath,
  joinKeys,
  onJoinKeyChange,
  loadingColumns,
  columnsError,
  disabled,
}) {
  const { t } = useTranslation();
  return (
    <div className="join-picker">
      {/* Contenedor propio para que el recorrido de bienvenida pueda resaltar el tipo de join
          (con su botón de ayuda) por separado de la columna clave (ver OnboardingTour). */}
      <div className="join-type-group">
        <div className="field-row">
          <span className="field-label field-label--inline">{t("join.typeLabel")}</span>
          <JoinTutorial />
        </div>
        <div className="format-picker" role="radiogroup" aria-label={t("join.typeAriaLabel")}>
          {JOIN_TYPES.map((type) => {
            const selected = joinType === type.value;
            return (
              <button
                key={type.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`format-pill ${selected ? "selected" : ""}`}
                disabled={disabled}
                onClick={() => onJoinTypeChange(type.value)}
              >
                {type.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field-group join-key-group">
        <label className="field-label">{t("join.keyPerFile")}</label>

        {files.length < 2 ? (
          <p className="join-key-hint">{t("join.needTwoFiles")}</p>
        ) : loadingColumns ? (
          <p className="join-key-hint">{t("join.readingColumns")}</p>
        ) : columnsError ? (
          <p className="join-key-hint join-key-hint--error">{columnsError}</p>
        ) : (
          <>
            <div className="join-key-list">
              {files.map((file) => {
                const cols = columnsByPath[file.path] || [];
                return (
                  <div className="join-key-row" key={file.path}>
                    <span className="join-key-file" title={file.name}>
                      {file.name}
                    </span>
                    {cols.length === 0 ? (
                      <span className="join-key-hint join-key-hint--error">{t("join.noColumns")}</span>
                    ) : (
                      <select
                        className="destination-input"
                        aria-label={t("join.keyAriaLabel", { file: file.name })}
                        value={joinKeys[file.path] || ""}
                        disabled={disabled}
                        onChange={(e) => onJoinKeyChange(file.path, e.target.value)}
                      >
                        <option value="" disabled>
                          {t("join.chooseColumn")}
                        </option>
                        {cols.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="join-key-note">{t("join.note")}</p>
          </>
        )}
      </div>
    </div>
  );
}
