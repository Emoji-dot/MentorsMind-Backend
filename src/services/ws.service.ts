import WebSocket from "ws";
import { logger } from "../utils/logger.utils";
import { randomUUID } from "crypto";
import { getRedisClients } from "../config/redis.pubsub";

type WsClient = WebSocket;

// In‑memory map of locally connected sockets per user
const clients = new Map<string, Set<WsClient>>();
// Keep track of which user channels we have subscribed to on the shared Redis subscriber
const subscribedChannels = new Set<string>();
// Unique identifier for this backend instance (used to avoid duplicate delivery)
const instanceId = randomUUID();

// Redis publisher/subscriber (initialized lazily)
let publisher: any = null;
let subscriber: any = null;
let subscriberInitialized = false;

export const WsService = {
  /** Add a client and ensure we are subscribed to the user's Redis channel */
  async addClient(userId: string, ws: WsClient): Promise<void> {
    if (!clients.has(userId)) {
      clients.set(userId, new Set());
    }
    clients.get(userId)!.add(ws);

    // Initialise Redis connections if this is the first client
    if (!subscriberInitialized) await this._initSubscriber();

    const channel = `ws:user:${userId}`;
    if (!subscribedChannels.has(channel)) {
      await subscriber.subscribe(channel);
      subscribedChannels.add(channel);
      logger.debug(`WsService subscribed to ${channel}`);
    }
  },

  /** Remove a client and clean up Redis subscription when no sockets remain for the user */
  async removeClient(userId: string, ws: WsClient): Promise<void> {
    const set = clients.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      clients.delete(userId);
      const channel = `ws:user:${userId}`;
      if (subscribedChannels.has(channel)) {
        await subscriber.unsubscribe(channel);
        subscribedChannels.delete(channel);
        logger.debug(`WsService unsubscribed from ${channel}`);
      }
    }
  },

  /** Directly send a payload to all locally connected sockets for a user */
  sendToUser(userId: string, event: string, data: unknown): void {
    const set = clients.get(userId);
    if (!set) return;
    const payload = JSON.stringify({ event, data });
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  },

  /** Publish a message to the per‑user Redis channel */
  async publish(userId: string, event: string, data: unknown): Promise<void> {
    if (!publisher) {
      const { pub } = await getRedisClients();
      publisher = pub;
    }
    const message = JSON.stringify({ event, data, originInstanceId: instanceId });
    const channel = `ws:user:${userId}`;
    await publisher.publish(channel, message);
  },

  /** Broadcast a message to all instances via a dedicated channel */
  async broadcastToAll(event: string, data: unknown): Promise<void> {
    if (!publisher) {
      const { pub } = await getRedisClients();
      publisher = pub;
    }
    const message = JSON.stringify({ event, data, originInstanceId: instanceId });
    await publisher.publish("ws:broadcast", message);
  },

  /** Initialise the shared Redis subscriber and set up message handling */
  async _initSubscriber(): Promise<void> {
    if (subscriberInitialized) return;
    const { sub } = await getRedisClients();
    subscriber = sub;

    subscriber.on("message", (channel: string, message: string) => {
      try {
        const { event, data, originInstanceId } = JSON.parse(message);
        // Ignore messages that originated from this instance
        if (originInstanceId === instanceId) return;

        if (channel === "ws:broadcast") {
          // Deliver to every connected client
          for (const [uid] of clients) {
            this.sendToUser(uid, event, data);
          }
        } else if (channel.startsWith("ws:user:")) {
          const userId = channel.split(":")[2];
          this.sendToUser(userId, event, data);
        }
      } catch (err) {
        logger.warn({ err }, "WsService: invalid Redis message");
      }
    });

    // Subscribe to the broadcast channel immediately; user channels are subscribed on addClient
    await subscriber.subscribe("ws:broadcast");
    subscriberInitialized = true;
    logger.info("WsService Redis subscriber initialised");
  },

  getConnectedCount(): number {
    let count = 0;
    for (const set of clients.values()) count += set.size;
    return count;
  },

  /** Cleanup in‑memory state; does not close Redis connections (handled by process shutdown) */
  cleanup(): void {
    clients.clear();
    subscribedChannels.clear();
    subscriberInitialized = false;
  },

  /** Exposed for testing only */
  _resetSubscribed(): void {
    subscribedChannels.clear();
    subscriberInitialized = false;
  },
};
