import { Controller, Post, Get, Body, HttpCode } from "@nestjs/common";
import { signupSchema, loginSchema, refreshSchema, type SignupInput, type LoginInput } from "@flux/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public, CurrentUser, type AuthUser } from "../common/decorators";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("signup")
  signup(@Body(new ZodValidationPipe(signupSchema)) body: SignupInput) {
    return this.auth.signup(body);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user.userId);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }
}
