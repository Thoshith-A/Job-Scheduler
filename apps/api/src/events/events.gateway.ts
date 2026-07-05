import { Inject, Module } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { queueRoom, type FluxEvent } from "@flux/shared";
import type { EventBus } from "@flux/infra";
import { EVENT_BUS } from "../common/tokens";

/**
 * Bridges the backend EventBus to dashboards over socket.io. Every job/worker/queue event
 * published by the API/scheduler/worker is relayed to connected clients in real time, so
 * the 3D control room animates from real state. (Cross-process delivery uses Redis pub/sub;
 * with the in-memory bus, only same-process events flow — the dashboard also polls as a
 * reliable baseline.)
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
})
export class EventsGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;

  constructor(@Inject(EVENT_BUS) private readonly bus: EventBus) {}

  async afterInit(): Promise<void> {
    await this.bus.subscribe((event: FluxEvent) => {
      // Global stream (dashboard filters client-side) + per-queue rooms for targeted views.
      this.server.emit("flux", event);
      if ("queueId" in event && event.queueId) {
        this.server.to(queueRoom(event.queueId)).emit("flux", event);
      }
    });
  }

  @SubscribeMessage("subscribe:queue")
  subscribeQueue(@ConnectedSocket() client: Socket, @MessageBody() queueId: string): void {
    client.join(queueRoom(queueId));
  }

  @SubscribeMessage("unsubscribe:queue")
  unsubscribeQueue(@ConnectedSocket() client: Socket, @MessageBody() queueId: string): void {
    client.leave(queueRoom(queueId));
  }
}

@Module({
  providers: [EventsGateway],
})
export class EventsModule {}
