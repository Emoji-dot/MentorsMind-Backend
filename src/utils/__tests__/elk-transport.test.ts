/**
 * Unit tests for ELKTransport and toECSDocument — Issue #740
 */

import { ELKTransport, toECSDocument } from "../../../utils/elk-transport";

// ---------------------------------------------------------------------------
// toECSDocument
// ---------------------------------------------------------------------------

describe("toECSDocument", () => {
  it("maps Pino log fields to ECS structure", () => {
    const pinoLog = {
      time: "2026-07-29T05:00:00.000Z",
      level: 30,
      msg: "User logged in",
      service: "mentorminds-backend",
      instanceId: "pod-1",
      requestId: "req-abc",
      correlationId: "corr-xyz",
      userId: "user-123",
      traceId: "trace-456",
      spanId: "span-789",
    };

    const doc = toECSDocument(pinoLog);

    expect(doc["@timestamp"]).toBe("2026-07-29T05:00:00.000Z");
    expect(doc["log.level"]).toBe("info");
    expect(doc.message).toBe("User logged in");
    expect(doc["service.name"]).toBe("mentorminds-backend");
    expect(doc["host.name"]).toBe("pod-1");
    expect(doc.requestId).toBe("req-abc");
    expect(doc.correlationId).toBe("corr-xyz");
    expect(doc.userId).toBe("user-123");
    expect(doc["trace.id"]).toBe("trace-456");
    expect(doc["span.id"]).toBe("span-789");
  });

  it("maps numeric Pino level 50 to error", () => {
    const doc = toECSDocument({ level: 50, msg: "err" });
    expect(doc["log.level"]).toBe("error");
  });

  it("maps numeric Pino level 40 to warn", () => {
    const doc = toECSDocument({ level: 40, msg: "warn" });
    expect(doc["log.level"]).toBe("warn");
  });

  it("maps numeric Pino level 60 to fatal", () => {
    const doc = toECSDocument({ level: 60, msg: "fatal" });
    expect(doc["log.level"]).toBe("fatal");
  });

  it("maps numeric Pino level 20 to debug", () => {
    const doc = toECSDocument({ level: 20, msg: "debug" });
    expect(doc["log.level"]).toBe("debug");
  });

  it("passes through additional fields", () => {
    const doc = toECSDocument({ level: 30, msg: "ok", customField: "value" });
    expect(doc["customField"]).toBe("value");
  });

  it("excludes standard pino housekeeping fields from passthrough", () => {
    const doc = toECSDocument({
      level: 30,
      msg: "ok",
      pid: 1234,
      hostname: "server-1",
    });
    // pid and hostname should not be in the ECS doc
    expect(doc["pid"]).toBeUndefined();
    expect(doc["hostname"]).toBeUndefined();
  });

  it("uses fallback timestamp when time is missing", () => {
    const before = Date.now();
    const doc = toECSDocument({ level: 30, msg: "no time" });
    const after = Date.now();
    const ts = new Date(doc["@timestamp"] as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// ELKTransport
// ---------------------------------------------------------------------------

describe("ELKTransport", () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: false, items: [] }),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("buffers documents before flushing", async () => {
    const transport = new ELKTransport({
      url: "http://localhost:9200",
      batchSize: 10,
      flushIntervalMs: 60_000,
    });

    transport.write({ "@timestamp": new Date().toISOString(), "log.level": "info", message: "test", "service.name": "svc", "service.environment": "test", "host.name": "h1" });
    transport.write({ "@timestamp": new Date().toISOString(), "log.level": "info", message: "test2", "service.name": "svc", "service.environment": "test", "host.name": "h1" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport.getStats().buffered).toBe(2);
  });

  it("flushes when batchSize is reached", async () => {
    const transport = new ELKTransport({
      url: "http://localhost:9200",
      batchSize: 2,
      flushIntervalMs: 60_000,
    });

    transport.write({ "@timestamp": new Date().toISOString(), "log.level": "info", message: "a", "service.name": "svc", "service.environment": "test", "host.name": "h1" });
    transport.write({ "@timestamp": new Date().toISOString(), "log.level": "info", message: "b", "service.name": "svc", "service.environment": "test", "host.name": "h1" });

    // Allow microtask queue to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(transport.getStats().buffered).toBe(0);
  });

  it("sends ndjson to /_bulk endpoint", async () => {
    const transport = new ELKTransport({
      url: "http://localhost:9200",
      batchSize: 1,
    });

    transport.write({ "@timestamp": "2026-07-29T05:00:00.000Z", "log.level": "info", message: "hello", "service.name": "svc", "service.environment": "test", "host.name": "h1" });

    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/_bulk"),
      expect.objectContaining({ method: "POST" }),
    );

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[1].headers["Content-Type"]).toBe("application/x-ndjson");
  });

  it("flush() sends buffered documents", async () => {
    const transport = new ELKTransport({
      url: "http://localhost:9200",
      batchSize: 100,
      flushIntervalMs: 60_000,
    });

    transport.write({ "@timestamp": new Date().toISOString(), "log.level": "warn", message: "manual flush", "service.name": "svc", "service.environment": "test", "host.name": "h1" });

    await transport.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(transport.getStats().buffered).toBe(0);
  });

  it("retries on server error and then drops batch after max retries", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const transport = new ELKTransport({
      url: "http://localhost:9200",
      batchSize: 100,
      maxRetries: 2,
      retryBaseDelayMs: 10,
    });

    transport.write({ "@timestamp": new Date().toISOString(), "log.level": "info", message: "retry test", "service.name": "svc", "service.environment": "test", "host.name": "h1" });

    await transport.flush();

    // 2 retries means fetch was called maxRetries times
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(transport.getStats().dropped).toBe(1);
  });

  it("does not retry on 4xx client error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });

    const transport = new ELKTransport({
      url: "http://localhost:9200",
      batchSize: 100,
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    transport.write({ "@timestamp": new Date().toISOString(), "log.level": "info", message: "client err", "service.name": "svc", "service.environment": "test", "host.name": "h1" });

    await transport.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
    expect(transport.getStats().dropped).toBe(1);
  });

  it("stop() flushes remaining buffer", async () => {
    const transport = new ELKTransport({
      url: "http://localhost:9200",
      batchSize: 100,
      flushIntervalMs: 60_000,
    });

    transport.write({ "@timestamp": new Date().toISOString(), "log.level": "info", message: "stop flush", "service.name": "svc", "service.environment": "test", "host.name": "h1" });

    await transport.stop();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
