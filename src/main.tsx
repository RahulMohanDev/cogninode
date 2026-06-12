import React            from "react";
import ReactDOM         from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import App              from "./App";
import type { ThemeMode } from "./hooks/useSettings";
import { getManagedConfig } from "./lib/managedConfig";
import { getConvexClient } from "./lib/convexClient";
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

// Managed mode (Clerk + Convex) switches on only when both env vars are
// configured — without them the tree below is the original local-first
// app with no backend on any runtime path. See lib/managedConfig.ts.
function Root() {
  const managed = getManagedConfig();
  const convexClient = getConvexClient();
  if (managed && convexClient) {
    return (
      <ClerkProvider publishableKey={managed.clerkPublishableKey} afterSignOutUrl="/">
        <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
          <App />
        </ConvexProviderWithClerk>
      </ClerkProvider>
    );
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>,
);
