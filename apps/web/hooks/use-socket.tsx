"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { WS_URL } from "@/lib/api";
import type { FluxEvent } from "@/lib/types";

type Handler = (event: FluxEvent) => void;

interface SocketContextValue {
  connected: boolean;
  /** Subscribe to the raw flux event stream. Returns an unsubscribe fn. */
  subscribe: (handler: Handler) => () => void;
  /** Monotonic counter bumped on every event — cheap way for panels to know "something moved". */
  eventCount: number;
}

const SocketContext = createContext<SocketContextValue | null>(null);

/**
 * Single shared socket.io connection. WS is a *live enhancement* layered on top of the
 * REST polling baseline — if it never connects, the dashboard still works from polls.
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const handlers = useRef<Set<Handler>>(new Set());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(WS_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000,
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));

    socket.on("flux", (event: FluxEvent) => {
      setEventCount((c) => (c + 1) % 1_000_000);
      handlers.current.forEach((h) => {
        try {
          h(event);
        } catch {
          /* a bad subscriber must not kill the stream */
        }
      });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const subscribe = useCallback((handler: Handler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  const value = useMemo<SocketContextValue>(
    () => ({ connected, subscribe, eventCount }),
    [connected, subscribe, eventCount],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within SocketProvider");
  return ctx;
}

/** Convenience: run a handler on every flux event for the lifetime of a component. */
export function useFluxEvents(handler: Handler) {
  const { subscribe } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}
