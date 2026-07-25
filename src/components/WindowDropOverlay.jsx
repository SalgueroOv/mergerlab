import React from "react";
import { useTranslation } from "react-i18next";

/**
 * Overlay a pantalla completa que aparece mientras se arrastra un archivo sobre cualquier punto
 * de la ventana (no solo la zona de carga de `FileList`). La detección del arrastre y el drop en
 * sí los gestiona `App.jsx` (listeners en `window`); este componente es solo la señal visual de
 * que soltar en cualquier parte de la ventana también funciona.
 * @param {{active: boolean}} props
 */
export default function WindowDropOverlay({ active }) {
  const { t } = useTranslation();
  if (!active) return null;

  return (
    <div className="window-drop-overlay" role="presentation">
      <div className="window-drop-overlay-inner">
        <p>{t("fileList.dropHint")}</p>
        <p className="window-drop-overlay-hint">{t("fileList.supportedFormats")}</p>
      </div>
    </div>
  );
}
