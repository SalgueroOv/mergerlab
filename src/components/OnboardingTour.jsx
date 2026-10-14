import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatMetaFor } from "../formatMeta.js";

const STORAGE_KEY = "mergerlab.onboarding.completed";

// Pasos del recorrido de bienvenida. `selector` apunta a un elemento ya existente en el DOM
// (por className/id) en vez de usar refs de React: los pasos solo necesitan leer la posición
// de elementos estructurales estables (paneles, botones), así que un querySelector evaluado en
// cada paso es más simple que encadenar refs a través de FileList/JoinPicker/etc. sin ganar nada.
// title/body son claves de traducción (no el texto en sí): se resuelven con t() dentro del
// componente, para que el recorrido se actualice si el usuario cambia de idioma a mitad de paso.
// `illustration` (opcional) añade un dibujo dentro del tooltip, para explicar controles que solo
// existen con archivos cargados (ver CsvRowIllustration).
const STEP_DEFS = [
  { selector: ".brand", titleKey: "tour.steps.welcome.title", bodyKey: "tour.steps.welcome.body" },
  { selector: ".panel-input", titleKey: "tour.steps.loadFiles.title", bodyKey: "tour.steps.loadFiles.body" },
  {
    selector: ".panel-input",
    titleKey: "tour.steps.csvFiles.title",
    bodyKey: "tour.steps.csvFiles.body",
    illustration: "csvRow",
  },
  {
    selector: ".mode-toggle",
    titleKey: "tour.steps.chooseMode.title",
    bodyKey: "tour.steps.chooseMode.body",
  },
  {
    selector: ".join-type-group",
    titleKey: "tour.steps.joinType.title",
    bodyKey: "tour.steps.joinType.body",
  },
  { selector: ".join-key-group", titleKey: "tour.steps.joinKey.title", bodyKey: "tour.steps.joinKey.body" },
  {
    selector: ".panel-output",
    titleKey: "tour.steps.configureOutput.title",
    bodyKey: "tour.steps.configureOutput.body",
  },
  // Visible en los dos modos (a diferencia de los pasos del join, que en modo apilar no
  // encuentran su elemento y muestran el tooltip centrado, sin resaltar nada).
  {
    selector: ".general-options-group",
    titleKey: "tour.steps.options.title",
    bodyKey: "tour.steps.options.body",
  },
  { selector: ".footer-actions", titleKey: "tour.steps.merge.title", bodyKey: "tour.steps.merge.body" },
  { selector: ".theme-toggle", titleKey: "tour.steps.theme.title", bodyKey: "tour.steps.theme.body" },
  { selector: ".about-trigger-btn", titleKey: "tour.steps.help.title", bodyKey: "tour.steps.help.body" },
];

/**
 * Indica si el usuario ya completó (o cerró) el recorrido de bienvenida en esta máquina.
 * La usa `App.jsx` para decidir si mostrarlo automáticamente al abrir la app.
 * @returns {boolean}
 */
export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // localStorage no disponible (ej. almacenamiento bloqueado): no insistimos con el tour.
    return true;
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // No es crítico: en el peor caso el tour se ofrece de nuevo la próxima vez.
  }
}

// Calcula top/left del tooltip (esquina superior izquierda, sin transform) a partir de su
// tamaño YA RENDERIZADO (tooltipRect), no de un alto supuesto: el texto traducido o una ventana
// chica pueden hacerlo más alto/ancho de lo esperado, y solo midiendo el tamaño real se puede
// garantizar que el clamp final lo deje siempre dentro del viewport.
/**
 * @param {DOMRect | null} rect posición del elemento resaltado en este paso (`null` en el paso
 *   de bienvenida, que no resalta nada y centra el tooltip en la ventana)
 * @param {DOMRect} tooltipRect tamaño ya renderizado del tooltip
 * @returns {{top: number, left: number}}
 */
function computeTooltipPosition(rect, tooltipRect) {
  const margin = 16;

  let top;
  let left;

  if (rect) {
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeBelow =
      spaceBelow > tooltipRect.height + margin * 2 || rect.top < tooltipRect.height + margin * 2;
    top = placeBelow ? rect.bottom + margin : rect.top - margin - tooltipRect.height;
    left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  } else {
    top = (window.innerHeight - tooltipRect.height) / 2;
    left = (window.innerWidth - tooltipRect.width) / 2;
  }

  top = Math.min(Math.max(top, margin), window.innerHeight - tooltipRect.height - margin);
  left = Math.min(Math.max(left, margin), window.innerWidth - tooltipRect.width - margin);

  return { top, left };
}

/**
 * Dibujo de una fila `.csv` de la lista de archivos, con el separador detectado, el botón de
 * vista previa y el aviso de detección dudosa. Reutiliza las clases CSS de la fila real de
 * `FileList` para verse igual, pero es solo ilustrativo: no hay archivos cargados durante el
 * recorrido (y simularlos obligaría a tocar el estado real de la app), así que el desplegable y
 * el botón no son interactivos (`pointer-events: none` en `.tour-illustration`).
 */
function CsvRowIllustration() {
  const { t } = useTranslation();
  const meta = formatMetaFor("csv");
  const autoLabel = t("fileList.csv.autoDetected", { separator: t("fileList.csv.semicolon") });
  return (
    <div className="tour-illustration" aria-hidden="true">
      <div className="file-list-item">
        <span className="drag-handle">⠿</span>
        <span className="file-badge" style={{ "--badge-color": meta.color }}>
          {meta.label}
        </span>
        <span className="file-name">ventas.csv</span>
        <span className="icon-btn tour-illustration-remove">×</span>
        <div className="csv-options">
          <div className="csv-options-row">
            <span className="csv-options-label">{t("fileList.csv.separatorLabel")}</span>
            <select className="destination-input csv-separator-select" tabIndex={-1} defaultValue="auto">
              <option value="auto">{autoLabel}</option>
            </select>
            <span className="btn subtle csv-preview-toggle">{t("fileList.csv.showPreview")}</span>
          </div>
          <p className="csv-options-warning">{t("fileList.csv.unsure")}</p>
        </div>
      </div>
    </div>
  );
}

const ILLUSTRATIONS = { csvRow: CsvRowIllustration };

/**
 * Recorrido de bienvenida tipo spotlight: resalta en secuencia los controles principales de la
 * app (ver `STEP_DEFS`) con un overlay a pantalla completa. Cualquier click avanza al siguiente
 * paso (no hay botón "Siguiente"); Esc lo cierra. Se marca como visto en `localStorage` al
 * terminar o cerrar, y se puede volver a lanzar desde "Acerca de" → "Ver tutorial de bienvenida"
 * (`replay-onboarding`, ver `App.jsx`).
 * @param {{active: boolean, onFinish: () => void}} props
 */
export default function OnboardingTour({ active, onFinish }) {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [tooltipPos, setTooltipPos] = useState(null);
  const tooltipRef = useRef(null);

  const measure = useCallback(() => {
    const step = STEP_DEFS[stepIndex];
    const el = step ? document.querySelector(step.selector) : null;
    setRect(el ? el.getBoundingClientRect() : null);
  }, [stepIndex]);

  useLayoutEffect(() => {
    if (active) measure();
  }, [active, measure]);

  useEffect(() => {
    if (!active) return undefined;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, measure]);

  // Se recalcula después de medir el tooltip ya pintado (con el contenido del paso actual),
  // así que el clamp de computeTooltipPosition usa el tamaño real, no una estimación.
  useLayoutEffect(() => {
    if (!active || !tooltipRef.current) return;
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    setTooltipPos(computeTooltipPosition(rect, tooltipRect));
  }, [active, rect, stepIndex]);

  const finish = useCallback(() => {
    markOnboardingSeen();
    onFinish();
    setStepIndex(0);
  }, [onFinish]);

  const advance = useCallback(() => {
    setStepIndex((current) => {
      if (current + 1 >= STEP_DEFS.length) {
        finish();
        return current;
      }
      return current + 1;
    });
  }, [finish]);

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        finish();
      } else if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, finish, advance]);

  if (!active) return null;

  const step = STEP_DEFS[stepIndex];
  const Illustration = step.illustration ? ILLUSTRATIONS[step.illustration] : null;

  // El overlay cubre toda la ventana con position:fixed y un z-index alto, así que es siempre
  // el elemento que recibe el click (nunca llega al botón/input real debajo). Por eso alcanza
  // con un único onClick acá: no hace falta interceptar/parar la propagación por separado, y
  // cualquier click "avanza" sin importar sobre qué parte de la app haya caído visualmente.
  return (
    <div className="tour-overlay" onClick={advance} role="presentation">
      {rect && (
        <div
          className="tour-highlight"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <div
        ref={tooltipRef}
        className={`tour-tooltip ${Illustration ? "tour-tooltip--wide" : ""}`}
        // Mientras no tengamos una medición del tooltip ya pintado (primer render de cada
        // paso), se mantiene invisible en vez de mostrarlo en una posición provisional: evita
        // el parpadeo de un tooltip fuera de lugar antes del clamp.
        style={
          tooltipPos
            ? { top: tooltipPos.top, left: tooltipPos.left, visibility: "visible" }
            : { top: 0, left: 0, visibility: "hidden" }
        }
      >
        <p className="tour-step-count">
          {t("tour.stepCount", { current: stepIndex + 1, total: STEP_DEFS.length })}
        </p>
        <h3>{t(step.titleKey)}</h3>
        <p className="tour-body">{t(step.bodyKey)}</p>
        {Illustration && <Illustration />}
        <p className="tour-hint">{t("tour.hint")}</p>
      </div>
    </div>
  );
}
