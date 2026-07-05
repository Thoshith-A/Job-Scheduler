/** Injection tokens for the shared infrastructure singletons. */
export const DB = Symbol("DB"); // DbHandle from @flux/db
export const REDIS = Symbol("REDIS"); // Redis | null
export const EVENT_BUS = Symbol("EVENT_BUS");
export const RATE_LIMITER = Symbol("RATE_LIMITER");
export const DIST_LOCK = Symbol("DIST_LOCK");
export const APP_CONFIG = Symbol("APP_CONFIG");
