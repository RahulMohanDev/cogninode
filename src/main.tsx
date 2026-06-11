import React            from "react";
import ReactDOM         from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App              from "./App";
import type { ThemeMode } from "./hooks/useSettings";
import "./styles/app.css";

// Early theme init — index.html's inline <script> already sets the
// `data-theme` attribute before paint to avoid a light-flash; this is a
// belt-and-braces re-application in case the inline script was skipped
// (CSP, hostile env, etc.).
(function bootstrapTheme(): void {
  try {
    const raw = localStorage.getItem("cogninode_theme");
    const mode: ThemeMode = raw === "light" ? "light" : "dark";
    if (document.documentElement.getAttribute("data-theme") !== mode) {
      document.documentElement.setAttribute("data-theme", mode);
    }
  } catch { /* ignore */ }
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
