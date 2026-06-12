/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as credits from "../credits.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as keys from "../keys.js";
import type * as lib_credits from "../lib/credits.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_razorpay from "../lib/razorpay.js";
import type * as models from "../models.js";
import type * as payments from "../payments.js";
import type * as openrouter from "../openrouter.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  credits: typeof credits;
  crons: typeof crons;
  http: typeof http;
  keys: typeof keys;
  "lib/credits": typeof lib_credits;
  "lib/env": typeof lib_env;
  "lib/razorpay": typeof lib_razorpay;
  models: typeof models;
  payments: typeof payments;
  openrouter: typeof openrouter;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
