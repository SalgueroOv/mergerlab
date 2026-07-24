import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function MiniTable({ x, y, width, height, rows, emphasis }) {
  const headerHeight = height / (rows + 1);
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="none" stroke="var(--accent)" strokeWidth="1.4" rx="2" />
      <rect x={x} y={y} width={width} height={headerHeight} fill="var(--accent)" fillOpacity={emphasis ? 0.75 : 0.35} />
      {Array.from({ length: rows - 1 }).map((_, i) => (
        <line
          key={i}
          x1={x}
          x2={x + width}
          y1={y + headerHeight * (i + 2)}
          y2={y + headerHeight * (i + 2)}
          stroke="var(--border)"
          strokeWidth="1"
        />
      ))}
    </g>
  );
}

function StackDiagram() {
  const { t } = useTranslation();
  return (
    <svg className="venn" viewBox="0 0 140 104" width="130" height="97" aria-hidden="true">
      <MiniTable x={4} y={4} width={34} height={26} rows={2} />
      <MiniTable x={44} y={4} width={34} height={26} rows={2} />
      <MiniTable x={84} y={4} width={34} height={26} rows={2} />
      <text x="21" y="40" textAnchor="middle" fontSize="7" fill="var(--text-muted)">
        {t("stackTutorial.diagram.file1")}
      </text>
      <text x="61" y="40" textAnchor="middle" fontSize="7" fill="var(--text-muted)">
        {t("stackTutorial.diagram.file2")}
      </text>
      <text x="101" y="40" textAnchor="middle" fontSize="7" fill="var(--text-muted)">
        {t("stackTutorial.diagram.file3")}
      </text>

      <defs>
        <marker id="stack-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
        </marker>
      </defs>
      <path d="M61 46 L61 58" stroke="var(--accent)" strokeWidth="1.6" markerEnd="url(#stack-arrow)" fill="none" />

      <MiniTable x={38} y={62} width={64} height={32} rows={6} emphasis />
      <text x="70" y="100" textAnchor="middle" fontSize="7" fill="var(--text-muted)">
        {t("stackTutorial.diagram.result")}
      </text>
    </svg>
  );
}

export default function StackTutorial() {
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
        aria-label={t("stackTutorial.buttonLabel")}
        title={t("stackTutorial.buttonLabel")}
      >
        ?
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("stackTutorial.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{t("stackTutorial.title")}</h3>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label={t("common.close")}>
                ×
              </button>
            </div>

            <div className="stack-tutorial-body">
              <StackDiagram />
              <p>{t("stackTutorial.body1")}</p>
              <p>{t("stackTutorial.body2")}</p>
              <ul className="stack-tutorial-list">
                <li>
                  <strong>{t("stackTutorial.headersOnceTerm")}</strong>: {t("stackTutorial.headersOnceNote")}
                </li>
                <li>
                  <strong>{t("stackTutorial.sourceColumnTerm")}</strong>: {t("stackTutorial.sourceColumnNote")}
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
