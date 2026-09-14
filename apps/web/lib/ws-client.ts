import type { ServerMessage } from "./types";

export interface WsClientOptions {
  url: string;
  onMessage: (message: ServerMessage) => void;
  onStatusChange: (status: "connecting" | "open" | "closed" | "error") => void;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  webSocketFactory?: (url: string) => WebSocket;
}

export function connectSimulationSocket(options: WsClientOptions): () => void {
  const minBackoff = options.minBackoffMs ?? 500;
  const maxBackoff = options.maxBackoffMs ?? 8000;
  let backoff = minBackoff;
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function open() {
    if (stopped) return;
    options.onStatusChange("connecting");
    const factory = options.webSocketFactory ?? ((url: string) => new WebSocket(url));
    socket = factory(options.url);
    socket.onopen = () => {
      backoff = minBackoff;
      options.onStatusChange("open");
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      options.onMessage(message);
    };
    socket.onerror = () => {
      options.onStatusChange("error");
    };
    socket.onclose = () => {
      options.onStatusChange("closed");
      if (!stopped) {
        reconnectTimer = setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      }
    };
  }

  open();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
}
