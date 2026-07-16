import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { Logger } from '../logger/index.js';

const HEARTBEAT_MS = 25_000;

/** One live SSE connection and the presence metadata carried on its request. */
interface SseConnection {
  res: ServerResponse;
  /** Stable per-browser id from `?deviceId=…`; null if the client didn't send one. */
  deviceId: string | null;
  ua: string;
  ip: string;
  since: number;
}

/** Read-only view of a connection for the presence module. */
export interface ConnectionInfo {
  deviceId: string | null;
  ua: string;
  ip: string;
  since: number;
}

/**
 * Single SSE endpoint for the whole app (`GET /api/events`). Modules never
 * touch this directly — they emit on the event bus and wiring code decides
 * what gets broadcast. The hub also knows every open connection, which the
 * presence module (PLAN-06) reads to build the live-device list.
 */
export class SseHub {
  private readonly connections = new Set<SseConnection>();
  private readonly changeListeners = new Set<() => void>();
  private heartbeat: NodeJS.Timeout | null = null;

  register(app: FastifyInstance, log: Logger): void {
    app.get('/api/events', (request, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(': connected\n\n');

      const query = request.query as { deviceId?: unknown };
      const connection: SseConnection = {
        res,
        deviceId: typeof query.deviceId === 'string' ? query.deviceId : null,
        ua: String(request.headers['user-agent'] ?? ''),
        ip: request.ip,
        since: Date.now(),
      };
      this.connections.add(connection);
      log.debug({ clients: this.connections.size }, 'sse client connected');
      this.emitChange();

      request.raw.on('close', () => {
        this.connections.delete(connection);
        log.debug({ clients: this.connections.size }, 'sse client disconnected');
        this.emitChange();
      });
    });

    this.heartbeat = setInterval(() => {
      for (const connection of this.connections) connection.res.write(': hb\n\n');
    }, HEARTBEAT_MS);
    // Don't let the heartbeat keep the process alive during shutdown.
    this.heartbeat.unref();
  }

  broadcast(event: string, payload: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const connection of this.connections) connection.res.write(frame);
  }

  get clientCount(): number {
    return this.connections.size;
  }

  /** One entry per open tab (a device with N tabs appears N times). */
  liveConnections(): ConnectionInfo[] {
    return [...this.connections].map(({ deviceId, ua, ip, since }) => ({ deviceId, ua, ip, since }));
  }

  /** Fires on every connect/disconnect — presence recomputes and broadcasts. */
  onConnectionChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const connection of this.connections) connection.res.end();
    this.connections.clear();
  }
}
