import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.enableCors({ origin: cfg.corsOrigin === "*" ? true : cfg.corsOrigin.split(","), credentials: true });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableShutdownHooks();

  await app.listen(cfg.port, cfg.host);
  Logger.log(`🚀 Flux API ready on http://${cfg.host}:${cfg.port}`, "Bootstrap");
}

bootstrap().catch((err) => {
  Logger.error(`Failed to start API: ${err instanceof Error ? err.message : err}`, "Bootstrap");
  process.exit(1);
});
