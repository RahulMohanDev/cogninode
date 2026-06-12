// convex/auth.config.ts
// Clerk is the identity provider. Requires a Clerk JWT template named
// "convex" and the CLERK_JWT_ISSUER_DOMAIN env var on the deployment
// (the Clerk Frontend API URL, e.g. https://verb-noun-00.clerk.accounts.dev).
import { env } from "./lib/env";

export default {
  providers: [
    {
      domain: env("CLERK_JWT_ISSUER_DOMAIN"),
      applicationID: "convex",
    },
  ],
};
