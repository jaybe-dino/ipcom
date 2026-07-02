import type { FastifyInstance } from "fastify";

/**
 * Lightweight production hardening: in-memory rate limiting (stricter on auth
 * to blunt brute force), request metrics, and a consistent error handler.
 * Single-node; a multi-node deployment swaps the limiter store for Redis.
 */

export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(key: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const t = this.now();
    const e = this.hits.get(key);
    if (!e || t >= e.reset) {
      this.hits.set(key, { count: 1, reset: t + this.windowMs });
      return { allowed: true, remaining: this.max - 1, retryAfterMs: 0 };
    }
    if (e.count >= this.max) return { allowed: false, remaining: 0, retryAfterMs: e.reset - t };
    e.count += 1;
    return { allowed: true, remaining: this.max - e.count, retryAfterMs: 0 };
  }
}

export class Metrics {
  total = 0;
  errors = 0;
  byStatus: Record<string, number> = {};
  private started = Date.now();

  record(status: number): void {
    this.total += 1;
    const bucket = `${Math.floor(status / 100)}xx`;
    this.byStatus[bucket] = (this.byStatus[bucket] ?? 0) + 1;
    if (status >= 500) this.errors += 1;
  }

  snapshot() {
    return { total: this.total, errors: this.errors, by_status: this.byStatus, uptime_ms: Date.now() - this.started };
  }
}

export interface ObservabilityOptions {
  generalMax?: number;
  authMax?: number;
  windowMs?: number;
}

export function registerObservability(app: FastifyInstance, opts: ObservabilityOptions = {}): void {
  const windowMs = opts.windowMs ?? Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const generalMax = opts.generalMax ?? Number(process.env.RATE_LIMIT_MAX ?? 600);
  const authMax = opts.authMax ?? Number(process.env.RATE_LIMIT_AUTH_MAX ?? 20);
  const general = new RateLimiter(generalMax, windowMs);
  const auth = new RateLimiter(authMax, windowMs);
  const metrics = new Metrics();

  app.addHook("onRequest", (req, reply, done) => {
    const url = req.url;
    // Skip infra + WebSocket upgrade.
    if (url.startsWith("/health") || url.startsWith("/metrics") || url.startsWith("/ws")) return done();
    const isAuth = url.startsWith("/auth/");
    const limiter = isAuth ? auth : general;
    const r = limiter.check(`${req.ip}:${isAuth ? "auth" : "gen"}`);
    if (!r.allowed) {
      reply
        .code(429)
        .header("retry-after", Math.ceil(r.retryAfterMs / 1000))
        .send({ error: "rate_limited" });
      return;
    }
    done();
  });

  app.addHook("onResponse", (_req, reply, done) => {
    metrics.record(reply.statusCode);
    done();
  });

  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    req.log.error(err);
    const status = err.statusCode ?? 500;
    reply.code(status).send({ error: status >= 500 ? "internal_error" : err.message });
  });

  app.get("/metrics", async () => metrics.snapshot());
}
