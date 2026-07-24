import React from "react";
import JoinTutorial from "./JoinTutorial.jsx";

const JOIN_TYPES = [
  { value: "inner", label: "Inner" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "outer", label: "Outer" },
];

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
  return (
    <div className="join-picker">
      <div className="field-row">
        <span className="field-label field-label--inline">Tipo de join</span>
        <JoinTutorial />
      </div>
      <div className="format-picker" role="radiogroup" aria-label="Tipo de join">
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

      <div className="field-group join-key-group">
        <label className="field-label">Columna clave por archivo</label>

        {files.length < 2 ? (
          <p className="join-key-hint">
            Añade al menos dos archivos para elegir la columna que los une.
          </p>
        ) : loadingColumns ? (
          <p className="join-key-hint">Leyendo columnas de los archivos...</p>
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
                      <span className="join-key-hint join-key-hint--error">Sin columnas legibles</span>
                    ) : (
                      <select
                        className="destination-input"
                        aria-label={`Columna clave en ${file.name}`}
                        value={joinKeys[file.path] || ""}
                        disabled={disabled}
                        onChange={(e) => onJoinKeyChange(file.path, e.target.value)}
                      >
                        <option value="" disabled>
                          Elige una columna...
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
            <p className="join-key-note">
              Cada archivo puede usar una columna con nombre distinto (por ejemplo "ID_Cliente" en
              uno y "Codigo Cliente" en otro): la app las trata como la misma clave al combinar.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
