// src/lib/files.ts
import { db, type StoredFile, newId } from "./db";

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
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";
    const buffer = await file.arrayBuffer();
    const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: any) => item.str).join(" "));
    }
    return pages.join("\n\n");
  }

  // Code and other text files
  return file.text();
}

export interface ProcessedFile {
  fileId:       string;
  name:         string;
  kind:         StoredFile["kind"];
  sizeBytes:    number;
  // For non-image files, the text content to append to the composer
  textToAppend?: string;
}

// Store file in Dexie and return metadata
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

  // Non-image files: inject content into composer as a block
  const textToAppend =
    kind === "pdf"
      ? `\n\n<document name="${file.name}">\n${content}\n</document>`
      : kind === "code"
      ? `\n\n\`\`\`${getExtension(file.name)}\n${content}\n\`\`\``
      : undefined;

  return {
    fileId,
    name:  file.name,
    kind,
    sizeBytes: file.size,
    ...(textToAppend !== undefined ? { textToAppend } : {}),
  };
}

function getExtension(filename: string): string {
  return filename.split(".").pop() ?? "";
}
