import axios from "axios";
import { randomUUID } from "crypto";
import pool from "../config/database";
import { chatbotMessagesTotal } from "../config/metrics";
import { logger } from "../utils/logger.utils";
import { CacheService } from "./cache.service";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface UserProfile {
  id: string;
  name: string;
  role: "mentor" | "mentee";
  language?: string;
}

export interface ChatbotMessage {
  id: string;
  userId: string;
  message: string;
  response: string;
  intent: string;
  confidence: number;
  escalated: boolean;
  timestamp: Date;
}

export interface ChatbotContext {
  userId: string;
  conversationHistory: Message[];
  userProfile: UserProfile;
  currentIntent: string;
  entities: Record<string, unknown>;
}

export interface ChatbotAnalytics {
  totalMessages: number;
  escalatedCount: number;
  topIntents: Record<string, number>;
  avgConfidence: number;
}

const INTENT_PATTERNS: Record<string, RegExp[]> = {
  booking: [/book|schedule|session|appointment/i],
  payment: [/pay|invoice|billing|charge|refund/i],
  profile: [/profile|account|settings|update/i],
  support: [/help|issue|problem|error|bug/i],
  onboarding: [/start|begin|how to|getting started|new/i],
};

export class ChatbotService {
  private readonly openaiApiKey = process.env.OPENAI_API_KEY;
  private readonly contextTtlSeconds = 30 * 60;
  private readonly historyLimit = 100;

  async chat(
    userId: string,
    message: string,
    userProfile: UserProfile,
  ): Promise<ChatbotMessage> {
    const context = await this.getOrCreateContext(userId, userProfile);
    const { intent, confidence } = this.classifyIntent(message);

    context.currentIntent = intent;
    context.conversationHistory.push({
      role: "user",
      content: message,
      timestamp: new Date(),
    });

    const escalated = confidence < 0.4 || intent === "support";
    const response = escalated
      ? await this.escalateToHuman(userId, message)
      : await this.getLLMResponse(context, message, userProfile.language);

    context.conversationHistory.push({
      role: "assistant",
      content: response,
      timestamp: new Date(),
    });

    const record: ChatbotMessage = {
      id: randomUUID(),
      userId,
      message,
      response,
      intent,
      confidence,
      escalated,
      timestamp: new Date(),
    };

    await this.saveContext(context);
    await this.storeMessage(record);
    chatbotMessagesTotal.inc({
      intent,
      escalated: String(escalated),
    });

    logger.info(
      `Chatbot: user=${userId} intent=${intent} confidence=${confidence} escalated=${escalated}`,
    );
    return record;
  }

  private classifyIntent(message: string): {
    intent: string;
    confidence: number;
  } {
    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
      if (patterns.some((p) => p.test(message))) {
        return { intent, confidence: 0.8 };
      }
    }
    return { intent: "general", confidence: 0.5 };
  }

  private async getLLMResponse(
    context: ChatbotContext,
    message: string,
    language = "en",
  ): Promise<string> {
    if (!this.openaiApiKey) {
      return this.getFallbackResponse(context.currentIntent);
    }

    try {
      const messages = [
        {
          role: "system",
          content: `You are a helpful assistant for MentorsMind platform. 
User role: ${context.userProfile.role}. 
Current intent: ${context.currentIntent}.
Respond in language: ${language}.
Be concise and helpful.`,
        },
        ...context.conversationHistory.slice(-6).map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: "user", content: message },
      ];

      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        { model: "gpt-4", messages, max_tokens: 300 },
        { headers: { Authorization: `Bearer ${this.openaiApiKey}` } },
      );

      return response.data.choices[0].message.content;
    } catch (err) {
      logger.error("LLM request failed", err);
      return this.getFallbackResponse(context.currentIntent);
    }
  }

  private async escalateToHuman(
    userId: string,
    _message: string,
  ): Promise<string> {
    logger.info(`Escalating conversation for user ${userId} to human support`);
    return (
      "I'm connecting you with a human support agent who can better assist you. " +
      "Please expect a response within 24 hours. Your message has been recorded."
    );
  }

  private getFallbackResponse(intent: string): string {
    const responses: Record<string, string> = {
      booking:
        "To book a session, go to the Sessions tab and select an available mentor.",
      payment:
        "For payment issues, visit your Billing settings or contact support@mentorsmind.com.",
      profile: "You can update your profile in Account Settings.",
      onboarding:
        "Welcome! Start by completing your profile and browsing available mentors.",
      general:
        "I'm here to help! Could you provide more details about your question?",
    };
    return responses[intent] ?? responses.general;
  }

  private contextKey(userId: string): string {
    return `chatbot:context:${userId}`;
  }

  private historyKey(userId: string): string {
    return `chatbot:history:${userId}`;
  }

  private async getOrCreateContext(
    userId: string,
    userProfile: UserProfile,
  ): Promise<ChatbotContext> {
    const cached = await CacheService.get<ChatbotContext>(this.contextKey(userId));
    if (cached) {
      return {
        ...cached,
        userProfile,
        conversationHistory: cached.conversationHistory.map((message) => ({
          ...message,
          timestamp: new Date(message.timestamp),
        })),
      };
    }

    return {
      userId,
      conversationHistory: [],
      userProfile,
      currentIntent: "general",
      entities: {},
    };
  }

  private async saveContext(context: ChatbotContext): Promise<void> {
    await CacheService.set(this.contextKey(context.userId), context, this.contextTtlSeconds);
  }

  private async storeMessage(record: ChatbotMessage): Promise<void> {
    await CacheService.lpushTrim(this.historyKey(record.userId), record, this.historyLimit, this.contextTtlSeconds);
    await pool.query(
      `INSERT INTO chatbot_messages (
         id, user_id, message, response, intent, confidence, escalated, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.id,
        record.userId,
        record.message,
        record.response,
        record.intent,
        record.confidence,
        record.escalated,
        record.timestamp,
      ],
    );
  }

  async clearHistory(userId: string): Promise<void> {
    await CacheService.del(this.contextKey(userId));
    await CacheService.del(this.historyKey(userId));
    await pool.query(
      `UPDATE chatbot_messages
       SET cleared_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
         AND cleared_at IS NULL`,
      [userId],
    );
  }

  async getHistory(userId: string, limit = this.historyLimit): Promise<ChatbotMessage[]> {
    const cached = await CacheService.lrange<ChatbotMessage>(this.historyKey(userId), 0, limit - 1);
    if (cached.length > 0) {
      return cached.map((message) => ({
        ...message,
        timestamp: new Date(message.timestamp),
      }));
    }

    const { rows } = await pool.query(
      `SELECT id, user_id, message, response, intent, confidence, escalated, created_at
       FROM chatbot_messages
       WHERE user_id = $1
         AND cleared_at IS NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      message: row.message,
      response: row.response,
      intent: row.intent,
      confidence: Number(row.confidence),
      escalated: row.escalated,
      timestamp: row.created_at,
    }));
  }

  async getAnalytics(): Promise<ChatbotAnalytics> {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::INTEGER AS total_messages,
         COUNT(*) FILTER (WHERE escalated = true)::INTEGER AS escalated_count,
         COALESCE(AVG(confidence), 0)::FLOAT AS avg_confidence
       FROM chatbot_messages
       WHERE cleared_at IS NULL`,
    );

    const intents = await pool.query(
      `SELECT intent, COUNT(*)::INTEGER AS count
       FROM chatbot_messages
       WHERE cleared_at IS NULL
       GROUP BY intent
       ORDER BY count DESC`,
    );

    const topIntents = intents.rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.intent] = Number(row.count);
      return acc;
    }, {});

    return {
      totalMessages: Number(rows[0]?.total_messages ?? 0),
      escalatedCount: Number(rows[0]?.escalated_count ?? 0),
      topIntents,
      avgConfidence: Number(rows[0]?.avg_confidence ?? 0),
    };
  }
}

export const chatbotService = new ChatbotService();
