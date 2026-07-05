import { Injectable, Inject } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";

export interface AccessClaims {
  sub: string;
  email: string;
}

/** Signs/verifies access + refresh JWTs with their respective secrets and TTLs. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async signAccess(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync({ ...claims }, {
      secret: this.cfg.jwt.accessSecret,
      expiresIn: this.cfg.jwt.accessTtl as unknown as number,
    });
  }

  async signRefresh(claims: AccessClaims & { jti: string }): Promise<string> {
    return this.jwt.signAsync({ ...claims }, {
      secret: this.cfg.jwt.refreshSecret,
      expiresIn: this.cfg.jwt.refreshTtl as unknown as number,
    });
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    return this.jwt.verifyAsync<AccessClaims>(token, { secret: this.cfg.jwt.accessSecret });
  }

  async verifyRefresh(token: string): Promise<AccessClaims & { jti: string }> {
    return this.jwt.verifyAsync(token, { secret: this.cfg.jwt.refreshSecret });
  }
}
