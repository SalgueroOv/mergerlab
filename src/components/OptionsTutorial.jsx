import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Secciones del modal, en el mismo orden que las casillas de "Opciones generales" en `App.jsx`,
// más una sobre el botón "Vista previa". `parts` son las claves de texto de cada sección (bajo
// `optionsTutorial.sections.<id>`), cada una en su propio párrafo.
const SECTIONS = [
  { id: "allAsText", parts: ["body", "when", "example"] },
  { id: "removeDuplicates", parts: ["body", "when", "example"] },
  { id: "includeReport", parts: ["body", "where", "example"] },
  { id: "preview", parts: ["body"] },
];

/**
 * Botón "?" junto a "Opciones generales" que abre un modal explicando las tres casillas comunes a
 * los dos modos (leer todo como texto, quitar filas duplicadas, incluir informe) y el botón
 * "Vista previa". Sin props: solo gestiona su propio estado de abierto/cerrado, igual que
 * `JoinTutorial`/`StackTutorial`.
 */
export default function OptionsTutorial() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // El nombre de la hoja y el sufijo del archivo del informe salen de las mismas claves que usa
  // el informe real (`report.*`), para que el texto nunca diga un nombre distinto del que se escribe.
  const reportNames = { sheetName: t("report.sheetName"), suffix: t("report.fileSuffix") };

  return (
    <>
      <button
        type="button"
        className="join-help-btn"
        onClick={() => setOpen(true)}
        aria-label={t("optionsTutorial.buttonLabel")}
        title={t("optionsTutorial.buttonLabel")}
      >
        ?
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("optionsTutorial.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{t("optionsTutorial.title")}</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
              >
                ×
              </button>
            </div>

            <p className="options-tutorial-intro">{t("optionsTutorial.intro")}</p>

            {SECTIONS.map(({ id, parts }) => (
              <section className="options-tutorial-section" key={id}>
                <h4>{t(`optionsTutorial.sections.${id}.title`)}</h4>
                {parts.map((part) => (
                  <p key={part}>{t(`optionsTutorial.sections.${id}.${part}`, reportNames)}</p>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
