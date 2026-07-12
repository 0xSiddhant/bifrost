import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { Logger } from '../logger/index.js';

const HEARTBEAT_MS = 25_000;

/**
 * Single SSE endpoint for the whole app (`GET /api/events`). Modules never
 * touch this directly — they emit on the event bus and wiring code decides
 * what gets broadcast.
 */
export class SseHub {
  private readonly clients = new Set<ServerResponse>();
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
      this.clients.add(res);
      log.debug({ clients: this.clients.size }, 'sse client connected');
      request.raw.on('close', () => {
        this.clients.delete(res);
        log.debug({ clients: this.clients.size }, 'sse client disconnected');
      });
    });

    this.heartbeat = setInterval(() => {
      for (const res of this.clients) res.write(': hb\n\n');
    }, HEARTBEAT_MS);
    // Don't let the heartbeat keep the process alive during shutdown.
    this.heartbeat.unref();
  }

  broadcast(event: string, payload: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.clients) res.write(frame);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
