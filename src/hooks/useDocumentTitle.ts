// src/hooks/useDocumentTitle.ts
// Sync the browser-tab title to the active chat/graph so multiple open
// tabs are tellable apart. The native tab tooltip shows the full string,
// covering names the tab strip truncates.

import { useEffect } from "react";

/** Must match <title> in index.html — restored on unmount. */
const BASE_TITLE = "cogninode beta";

export function useDocumentTitle(title: string | undefined | null): void {
  useEffect(() => {
    document.title = title?.trim() ? `${title.trim()} — cogninode` : BASE_TITLE;
    return () => { document.title = BASE_TITLE; };
  }, [title]);
}
