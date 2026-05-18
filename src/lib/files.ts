// src/lib/files.ts
import { db, type StoredFile, newId } from "./db";

// Bundle the pdf.js worker as a static asset via Vite's ?url import. This
// avoids the version-drift footgun of hardcoding a CDN URL — the worker
// stays in lockstep with the installed pdfjs-dist version, and there's no
// network round-trip for the worker bootstrap.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export function inferKind(file: File): StoredFile["kind"] {
  if (file.type.startsWith("image/"))           return "image";
  if (file.type === "application/pdf")          return "pdf";
  if (/\.(ts|tsx|js|jsx|py|go|rs|rb|java|c|cpp|cs|php|swift|kt)$/i.test(file.name))
    return "code";
  return "file";
}

// Convert file to storable content
export async function readFileContent(file: File, kind: StoredFile["kind"]): Promise<string> {
  if (kind === "image") {
    // Base64 data URL — sent directly to OpenRouter as image_url
    return new Promise((resolve, reject) => {
      const reader  = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  if (kind === "pdf") {
    // Extract text with pdf.js (loaded on demand)
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const buffer = await file.arrayBuffer();
    const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map(item => ("str" in item ? item.str : ""))
          .join(" "),
      );
    }
    return pages.join("\n\n");
  }

  // Code and other text files
  return file.text();
}

export interface ProcessedFile {
  fileId:    string;
  name:      string;
  kind:      StoredFile["kind"];
  sizeBytes: number;
}

// Store file in Dexie and return metadata. File content is *only* persisted
// to db.files; injection into the prompt happens later in buildPathMessages
// so the composer textarea isn't polluted with raw document text.
export async function storeFile(file: File): Promise<ProcessedFile> {
  const kind    = inferKind(file);
  const content = await readFileContent(file, kind);
  const fileId  = newId();

  await db.files.add({
    _id:       fileId,
    name:      file.name,
    kind,
    mimeType:  file.type,
    sizeBytes: file.size,
    content,
    createdAt: Date.now(),
  });

  return {
    fileId,
    name:  file.name,
    kind,
    sizeBytes: file.size,
  };
}
