import React from "react";

export default function AboutDialog() {
  return (
    <button
      type="button"
      className="btn subtle about-trigger-btn"
      onClick={() => window.electronAPI.openAboutWindow()}
    >
      Acerca de
    </button>
  );
}
