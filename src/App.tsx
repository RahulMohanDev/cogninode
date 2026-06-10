import { Routes, Route } from "react-router-dom";
import { ApiKeyGate } from "./components/setup/ApiKeyGate";
import { SettingsProvider } from "./hooks/useSettings";
import { StreamsProvider } from "./hooks/StreamsProvider";
import { ModelsProvider } from "./hooks/ModelsProvider";
import { ToastProvider } from "./components/ui/Toast";
import { SearchOverlay } from "./components/search/SearchOverlay";
import Chats from "./pages/Chats";
import Chat from "./pages/Chat";
import Reflections from "./pages/Reflections";

export default function App() {
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
                        <ApiKeyGate>
                            <Routes>
                                <Route path="/" element={<Chats />} />
                                <Route path="/reflections" element={<Reflections />} />
                                <Route path="/chat/:chatId" element={<Chat />} />
                            </Routes>
                            {/* ⌘K palette — global so it works on every page;
                                also bootstraps the search index + semantic layer. */}
                            <SearchOverlay />
                        </ApiKeyGate>
                    </StreamsProvider>
                </ModelsProvider>
            </ToastProvider>
        </SettingsProvider>
    );
}
