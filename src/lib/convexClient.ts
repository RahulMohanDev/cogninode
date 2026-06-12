// src/lib/convexClient.ts
// The ConvexReactClient singleton. Exposed as a module (rather than only
// through React context) so non-React code — StreamsProvider's async send
// closures, the future sync engine — can call mutations/actions directly,
// the same way setCatalogMirror exposes the model catalog. Null in local
// (non-managed) mode.

import { ConvexReactClient } from "convex/react";
import { getManagedConfig } from "./managedConfig";

let client: ConvexReactClient | null | undefined;

export function getConvexClient(): ConvexReactClient | null {
  if (client === undefined) {
    const cfg = getManagedConfig();
    client = cfg ? new ConvexReactClient(cfg.convexUrl) : null;
  }
  return client;
}
