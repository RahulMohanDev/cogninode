// src/App.tsx
import { Routes, Route }    from "react-router-dom";
import { ApiKeyGate }       from "./components/setup/ApiKeyGate";
import Chats                from "./pages/Chats";
import Chat                 from "./pages/Chat";

export default function App() {
  return (
    <ApiKeyGate>
      <Routes>
        <Route path="/"              element={<Chats />} />
        <Route path="/chat/:chatId"  element={<Chat />} />
      </Routes>
    </ApiKeyGate>
  );
}
