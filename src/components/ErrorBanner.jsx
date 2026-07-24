import React from "react";

export default function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;

  return (
    <div className="banner banner-error" role="alert">
      <span className="banner-icon">⚠</span>
      <span className="banner-text">{message}</span>
      <button type="button" className="banner-close" onClick={onDismiss} aria-label="Cerrar">
        ✕
      </button>
    </div>
  );
}
