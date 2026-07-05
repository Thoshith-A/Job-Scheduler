import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { orgRoleEnum } from "./enums";

/**
 * Identity & tenancy.
 *
 *   users ──< organization_members >── organizations ──< projects
 *
 * A user may belong to many organizations (multi-tenant SaaS shape); membership
 * carries an RBAC role. Everything a user can touch is scoped through a project,
 * which is owned by an organization.
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    // argon2id hash — never the plaintext.
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Login looks users up by email; must be globally unique.
    uniqueIndex("users_email_key").on(t.email),
  ],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A user has exactly one membership row per org.
    primaryKey({ columns: [t.organizationId, t.userId] }),
    // "List the orgs this user belongs to" — reverse lookups.
    index("org_members_user_idx").on(t.userId),
  ],
);

/**
 * Refresh-token rotation: each issued refresh token is persisted (hashed). On use
 * we rotate — mark the old row revoked and issue a new one — so a stolen token is
 * single-use and reuse is detectable.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    // Chain rotations so we can detect reuse of an already-rotated token.
    replacedBy: uuid("replaced_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_key").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Slugs are unique within an organization, not globally.
    uniqueIndex("projects_org_slug_key").on(t.organizationId, t.slug),
  ],
);

/**
 * Programmatic access. The raw key is shown once at creation; only a hash is stored.
 * Keys are scoped to a project and carry coarse scopes (jobs:write, etc.).
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // sha-256 of the presented key; lookups hash-then-match.
    keyHash: text("key_hash").notNull(),
    // Non-secret public prefix (e.g. "flux_live_ab12") for display + fast narrowing.
    keyPrefix: text("key_prefix").notNull(),
    scopes: jsonb("scopes").notNull().$type<string[]>().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_key").on(t.keyHash),
    index("api_keys_project_idx").on(t.projectId),
    index("api_keys_prefix_idx").on(t.keyPrefix),
  ],
);
