import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { TokenService } from "./token.service";

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, TokenService],
  controllers: [AuthController],
  exports: [TokenService],
})
export class AuthModule {}
