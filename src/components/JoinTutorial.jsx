import React, { useEffect, useState } from "react";

const JOIN_INFO = [
  {
    type: "inner",
    title: "Inner join (intersección)",
    description:
      "Solo quedan las filas cuya columna clave existe en TODOS los archivos combinados. " +
      "Ejemplo: quiénes tienen seguro médico Y gimnasio.",
  },
  {
    type: "left",
    title: "Left join (izquierda)",
    description:
      "Quedan todas las filas del primer archivo, completando con datos de los demás cuando la clave coincide " +
      "(vacío si no hay coincidencia). Ejemplo: todos los que tienen seguro médico, tengan o no gimnasio.",
  },
  {
    type: "right",
    title: "Right join (derecha)",
    description:
      "Es el espejo del left join: quedan todas las filas del otro archivo, completando con datos del primero " +
      "cuando coincide. Ejemplo: todos los que tienen gimnasio, tengan o no seguro médico.",
  },
  {
    type: "outer",
    title: "Outer join (completo)",
    description:
      "Quedan todas las filas de todos los archivos, coincidan o no. Los datos que faltan quedan en blanco. " +
      "Ejemplo: todos los que tienen seguro médico O gimnasio (o ambos).",
  },
];

function VennDiagram({ type }) {
  const highlightA = type === "left" || type === "outer";
  const highlightB = type === "right" || type === "outer";
  const highlightIntersection = type === "inner";

  return (
    <svg className="venn" viewBox="0 0 120 76" width="90" height="57" aria-hidden="true">
      {highlightA && <circle cx="46" cy="38" r="28" fill="var(--accent)" fillOpacity="0.55" />}
      {highlightB && <circle cx="74" cy="38" r="28" fill="var(--accent)" fillOpacity="0.55" />}
      {highlightIntersection && (
        <>
          <defs>
            <clipPath id={`clip-${type}`}>
              <circle cx="74" cy="38" r="28" />
            </clipPath>
          </defs>
          <g clipPath={`url(#clip-${type})`}>
            <circle cx="46" cy="38" r="28" fill="var(--accent)" fillOpacity="0.55" />
          </g>
        </>
      )}
      <circle cx="46" cy="38" r="28" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="74" cy="38" r="28" fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

export default function JoinTutorial() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="join-help-btn"
        onClick={() => setOpen(true)}
        aria-label="Qué significa cada tipo de join"
        title="Qué significa cada tipo de join"
      >
        ?
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Tipos de join"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Tipos de join</h3>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Cerrar">
                ×
              </button>
            </div>

            <div className="join-tutorial-grid">
              {JOIN_INFO.map((info) => (
                <div className="join-tutorial-card" key={info.type}>
                  <VennDiagram type={info.type} />
                  <h4>{info.title}</h4>
                  <p>{info.description}</p>
                </div>
              ))}
            </div>

            <p className="join-tutorial-note">
              Si combinas más de dos archivos, el join se aplica en cadena y en el orden en que
              aparecen en la lista: primero el archivo 1 con el 2, ese resultado con el 3, y así
              sucesivamente.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
