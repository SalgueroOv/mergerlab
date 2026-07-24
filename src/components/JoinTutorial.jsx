import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const JOIN_TYPES = ["inner", "left", "right", "outer"];

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

  return (
    <>
      <button
        type="button"
        className="join-help-btn"
        onClick={() => setOpen(true)}
        aria-label={t("joinTutorial.buttonLabel")}
        title={t("joinTutorial.buttonLabel")}
      >
        ?
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("joinTutorial.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{t("joinTutorial.title")}</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
              >
                ×
              </button>
            </div>

            <div className="join-tutorial-grid">
              {JOIN_TYPES.map((type) => (
                <div className="join-tutorial-card" key={type}>
                  <VennDiagram type={type} />
                  <h4>{t(`joinTutorial.types.${type}.title`)}</h4>
                  <p>{t(`joinTutorial.types.${type}.description`)}</p>
                </div>
              ))}
            </div>

            <p className="join-tutorial-note">{t("joinTutorial.chainNote")}</p>
          </div>
        </div>
      )}
    </>
  );
}
