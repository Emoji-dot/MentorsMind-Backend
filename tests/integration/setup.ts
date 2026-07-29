import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import pool from "../../src/config/database";
import { CacheService } from "../../src/services/cache.service";

let pgContainer: any;
let redisContainer: any;

export const setupContainers = async () => {
  // Start Redis Container
  redisContainer = await new RedisContainer().start();
  process.env.REDIS_URL = redisContainer.getConnectionUrl();

  // Start PostgreSQL Container
  pgContainer = await new PostgreSqlContainer().start();
  process.env.DATABASE_URL = pgContainer.getConnectionUri();

  // You would typically run migrations here
  // For demonstration, we just connect to ensure it's up.
  await pool.connect();
};

export const teardownContainers = async () => {
  if (pgContainer) {
    await pgContainer.stop();
  }
  if (redisContainer) {
    await redisContainer.stop();
  }
};
