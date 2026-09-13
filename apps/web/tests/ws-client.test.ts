import { describe, it, expect, vi } from "vitest";
import { connectSimulationSocket } from "../lib/ws-client";

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
}

describe("connectSimulationSocket", () => {
  it("reconnects with backoff after the socket closes", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const factory = () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    };
    const onStatusChange = vi.fn();
    const stop = connectSimulationSocket({
      url: "ws://test",
      onMessage: vi.fn(),
      onStatusChange,
      minBackoffMs: 100,
      maxBackoffMs: 1000,
      webSocketFactory: factory,
    });

    expect(sockets).toHaveLength(1);
    sockets[0].onclose?.();
    expect(onStatusChange).toHaveBeenCalledWith("closed");

    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);

    // A reconnect is pending (queued by the second socket's close) when stop()
    // is called — it must not be allowed to fire.
    sockets[1].onclose?.();
    stop();
    vi.advanceTimersByTime(10000);
    expect(sockets).toHaveLength(2);

    vi.useRealTimers();
  });
});
