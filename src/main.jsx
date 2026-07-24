import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { initI18n } from "./i18n/index.js";
import "./styles.css";

// El splash screen (electron/main.js) sigue visible hasta que esta ventana pinta su primer
// frame, así que montar React recién después de tener el idioma listo no genera parpadeo.
initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
