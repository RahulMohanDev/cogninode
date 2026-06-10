// src/hooks/useSettingsHotkey.ts
// ⌃, / ⌘, opens Settings — advertised in the shortcuts cheat sheet. Each
// page that owns a <SettingsModal> mounts this once. Fires even while a
// field is focused (matching native-app convention for the settings combo).

import { useEffect, useRef } from "react";

export function useSettingsHotkey(onOpen: () => void): void {
  const ref = useRef(onOpen);
  ref.current = onOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== ",") return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
