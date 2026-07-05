import { Injectable, Inject } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { schema, eq, and, isNull, type DbHandle } from "@flux/db";
import { DomainError, type SignupInput, type LoginInput } from "@flux/shared";
import { DB } from "../common/tokens";
import { TokenService } from "./token.service";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly dbh: DbHandle,
    private readonly tokens: TokenService,
  ) {}
  private get db() {
    return this.dbh.db;
  }

  async signup(input: SignupInput) {
    const existing = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, input.email.toLowerCase()));
    if (existing.length > 0) throw new DomainError("CONFLICT", "Email already registered");

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({ email: input.email.toLowerCase(), passwordHash, name: input.name })
        .returning();

      const orgName = input.organizationName ?? `${input.name}'s Organization`;
      const slug = `${orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${randomUUID().slice(0, 6)}`;
      const [org] = await tx
        .insert(schema.organizations)
        .values({ name: orgName, slug })
        .returning();
      await tx
        .insert(schema.organizationMembers)
        .values({ organizationId: org!.id, userId: user!.id, role: "owner" });

      const pair = await this.issueTokens(tx as unknown as typeof this.db, user!.id, user!.email);
      return {
        user: { id: user!.id, email: user!.email, name: user!.name },
        organization: { id: org!.id, name: org!.name, slug: org!.slug, role: "owner" as const },
        ...pair,
      };
    });
  }

  async login(input: LoginInput): Promise<TokenPair & { user: { id: string; email: string; name: string } }> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, input.email.toLowerCase()));
    if (!user) throw new DomainError("INVALID_CREDENTIALS", "Invalid email or password");

    const ok = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!ok) throw new DomainError("INVALID_CREDENTIALS", "Invalid email or password");

    const pair = await this.issueTokens(this.db, user.id, user.email);
    return { user: { id: user.id, email: user.email, name: user.name }, ...pair };
  }

  /** Rotate a refresh token; detect reuse of an already-rotated token. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let claims: { sub: string; email: string; jti: string };
    try {
      claims = await this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw new DomainError("TOKEN_INVALID", "Invalid refresh token");
    }

    const [row] = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, claims.jti));

    if (!row || row.tokenHash !== sha256(refreshToken)) {
      throw new DomainError("TOKEN_INVALID", "Refresh token not recognized");
    }
    if (row.revokedAt) {
      // Reuse of a rotated token => likely theft. Revoke the whole family.
      await this.db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.refreshTokens.userId, row.userId), isNull(schema.refreshTokens.revokedAt)));
      throw new DomainError("TOKEN_INVALID", "Refresh token reuse detected; sessions revoked");
    }
    if (row.expiresAt < new Date()) throw new DomainError("TOKEN_EXPIRED", "Refresh token expired");

    return this.db.transaction(async (tx) => {
      const pair = await this.issueTokens(tx as unknown as typeof this.db, claims.sub, claims.email);
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date(), replacedBy: pair.jti })
        .where(eq(schema.refreshTokens.id, row.id));
      return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    });
  }

  async logout(userId: string): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));
  }

  async me(userId: string) {
    const [user] = await this.db
      .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) throw new DomainError("NOT_FOUND", "User not found");

    const orgs = await this.db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        role: schema.organizationMembers.role,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.organizations, eq(schema.organizationMembers.organizationId, schema.organizations.id))
      .where(eq(schema.organizationMembers.userId, userId));

    return { user, organizations: orgs };
  }

  private async issueTokens(
    db: typeof this.db,
    userId: string,
    email: string,
  ): Promise<TokenPair & { jti: string }> {
    const accessToken = await this.tokens.signAccess({ sub: userId, email });
    const jti = randomUUID();
    const refreshToken = await this.tokens.signRefresh({ sub: userId, email, jti });
    await db.insert(schema.refreshTokens).values({
      id: jti,
      userId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
    return { accessToken, refreshToken, jti };
  }
}
