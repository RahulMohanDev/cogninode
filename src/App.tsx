// src/App.tsx
import { Routes, Route }    from "react-router-dom";
import { ApiKeyGate }       from "./components/setup/ApiKeyGate";
import { StreamsProvider }  from "./hooks/StreamsProvider";
import Chats                from "./pages/Chats";
import Chat                 from "./pages/Chat";

export default function App() {
  // StreamsProvider lives above ApiKeyGate so the per-node stream store
  // and its abort registry are alive for the entire app lifetime —
  // shouldn't matter in practice (gate-shown means no key, no streams)
  // but it keeps the context unconditional for every consumer.
  return (
    <StreamsProvider>
      <ApiKeyGate>
        <Routes>
          <Route path="/"              element={<Chats />} />
          <Route path="/chat/:chatId"  element={<Chat />} />
        </Routes>
      </ApiKeyGate>
    </StreamsProvider>
  );
}
