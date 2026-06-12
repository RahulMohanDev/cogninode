import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AccessGate } from "./components/setup/AccessGate";
import { SettingsProvider } from "./hooks/useSettings";
import { StreamsProvider } from "./hooks/StreamsProvider";
import { CreditsProvider } from "./hooks/useCredits";
import { TiersProvider } from "./hooks/useTiers";
import { ModelsProvider } from "./hooks/ModelsProvider";
import { ToastProvider } from "./components/ui/Toast";
import { SearchOverlay } from "./components/search/SearchOverlay";
import { SyncAgent } from "./components/sync/SyncAgent";
import Chats from "./pages/Chats";
import Chat from "./pages/Chat";
import Reflections from "./pages/Reflections";
import Graphs from "./pages/Graphs";

// The graph editor pulls in React Flow — lazy so it loads on first visit.
const GraphEditor = lazy(() => import("./pages/GraphEditor"));
const Legal = lazy(() => import("./pages/Legal"));

export default function App() {
    // /legal is public by requirement (payment-provider KYC reviewers and
    // signed-out users must reach it) — short-circuit before the gate.
    const { pathname } = useLocation();
    if (pathname === "/legal") {
        return (
            <Suspense fallback={null}>
                <Legal />
            </Suspense>
        );
    }
    // SettingsProvider sits above everything so the shared apiKey it owns is
    // visible to StreamsProvider (which reads it to make requests) and to the
    // gate (which shows the setup screen when it's empty). A 401 reset clears
    // the key here and the gate re-renders on the spot — no reload.
    // ToastProvider sits just below it so every page (and the gate) can fire
    // notifications.
    return (
        <SettingsProvider>
            <ToastProvider>
                <ModelsProvider>
                    <StreamsProvider>
                        <CreditsProvider>
                        <TiersProvider>
                        <AccessGate>
                            <Routes>
                                <Route path="/" element={<Chats />} />
                                <Route path="/reflections" element={<Reflections />} />
                                <Route path="/graphs" element={<Graphs />} />
                                <Route
                                    path="/graphs/:graphId"
                                    element={
                                        <Suspense fallback={<div className="tw:h-dvh tw:grid tw:place-items-center tw:text-ink-3 tw:text-[14px]">Loading graph…</div>}>
                                            <GraphEditor />
                                        </Suspense>
                                    }
                                />
                                <Route path="/chat/:chatId" element={<Chat />} />
                                <Route path="*" element={<Navigate to="/" replace />} />
                            </Routes>
                            {/* ⌘K palette — global so it works on every page;
                                also bootstraps the search index + semantic layer. */}
                            <SearchOverlay />
                            {/* Sync runs only past the gate: auth + the
                                account-link check must settle before any
                                local data leaves the device. */}
                            <SyncAgent />
                        </AccessGate>
                        </TiersProvider>
                        </CreditsProvider>
                    </StreamsProvider>
                </ModelsProvider>
            </ToastProvider>
        </SettingsProvider>
    );
}
