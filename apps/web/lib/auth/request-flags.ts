// Per-request facts the auth library's hooks report to the route that called it (R-42): the
// catch-all auth route runs the library's handler inside this store and reads it afterwards.
import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthRequestFlags {
  /** A password credential was deleted during this request (first magic-link sign-in). */
  passwordRemoved: boolean;
}

export const authRequestFlags = new AsyncLocalStorage<AuthRequestFlags>();
