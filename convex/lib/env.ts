// convex/lib/env.ts
// Deployment environment variables. Typed locally (module-scoped ambient
// declaration) so server modules typecheck in the app's tsconfig too — the
// client's `import { api } from "convex/_generated/api"` pulls them into the
// app's TS program, which has DOM libs but no node types.
declare const process: { env: Record<string, string | undefined> };

export function env(name: string): string | undefined {
  return process.env[name];
}
