import Redis from "ioredis";
import { redisConfig } from "./redis.config";

export const CHANNEL = "ws:events";

let sub: Redis | null = null;
let pub: Redis | null = null;

export async function getRedisClients(): Promise<{
  sub: Redis;
  pub: Redis;
  CHANNEL: string;
}> {
  const url = redisConfig.url!;
  const isTls = url.startsWith('rediss://');
  const tlsOptions = isTls ? { tls: { rejectUnauthorized: false } } : {};

  if (!sub) {
    sub = new Redis(url, { lazyConnect: true, ...tlsOptions });
    await sub.connect();
  }
  if (!pub) {
    pub = new Redis(url, { lazyConnect: true, ...tlsOptions });
    await pub.connect();
  }
  return { sub, pub, CHANNEL };
}
