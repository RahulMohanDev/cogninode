import { Routes, Route } from "react-router-dom";
import { ApiKeyGate } from "./components/setup/ApiKeyGate";
import { SettingsProvider } from "./hooks/useSettings";
import { StreamsProvider } from "./hooks/StreamsProvider";
import Chats from "./pages/Chats";
import Chat from "./pages/Chat";

export default function App() {
    // SettingsProvider sits above everything so the shared apiKey it owns is
    // visible to StreamsProvider (which reads it to make requests) and to the
    // gate (which shows the setup screen when it's empty). A 401 reset clears
    // the key here and the gate re-renders on the spot — no reload.
    return (
        <SettingsProvider>
            <StreamsProvider>
                <ApiKeyGate>
                    <Routes>
                        <Route path="/" element={<Chats />} />
                        <Route path="/chat/:chatId" element={<Chat />} />
                    </Routes>
                </ApiKeyGate>
            </StreamsProvider>
        </SettingsProvider>
    );
}
