/**
 * NlpSearchService
 *
 * NLP-powered semantic search with query understanding, typo tolerance,
 * synonym expansion, personalized ranking, and search suggestions.
 * Uses PostgreSQL full-text search with pg_trgm for typo tolerance,
 * and stores embeddings for semantic similarity when available.
 */

import pool from "../config/database";

export type SearchIntent =
  | "find_mentor"
  | "find_session"
  | "find_content"
  | "general";

export interface Entity {
  type: "skill" | "topic" | "language" | "location" | "name";
  value: string;
}

export interface SearchFilters {
  type?: "mentor" | "session" | "content";
  minRating?: number;
  maxPrice?: number;
  language?: string;
  skills?: string[];
}

export interface SemanticSearchQuery {
  query: string;
  embedding: number[];
  intent: SearchIntent;
  entities: Entity[];
  filters: SearchFilters;
}

export interface SearchResult {
  id: string;
  type: "mentor" | "session" | "content";
  relevanceScore: number;
  semanticScore: number;
  matchedTerms: string[];
  snippet: string;
}

export interface SearchSuggestion {
  text: string;
  type: "autocomplete" | "correction" | "expansion";
}

// Common synonyms for query expansion
const SYNONYMS: Record<string, string[]> = {
  javascript: ["js", "node", "nodejs", "typescript", "ts"],
  python: ["py", "django", "flask", "fastapi"],
  machine_learning: ["ml", "ai", "deep learning", "neural network"],
  frontend: ["ui", "react", "vue", "angular", "css", "html"],
  backend: ["server", "api", "database", "sql", "rest"],
  beginner: ["starter", "intro", "introduction", "basic", "fundamentals"],
  advanced: ["expert", "senior", "professional", "experienced"],
};

export class NlpSearchService {
  /**
   * Parse a natural language query into structured intent, entities, and filters.
   */
  static parseQuery(
    rawQuery: string,
  ): Pick<SemanticSearchQuery, "intent" | "entities" | "filters"> {
    const lower = rawQuery.toLowerCase();
    const entities: Entity[] = [];
    const filters: SearchFilters = {};

    // Detect intent
    let intent: SearchIntent = "general";
    if (/mentor|coach|teacher|tutor/.test(lower)) intent = "find_mentor";
    else if (/session|class|lesson|course/.test(lower)) intent = "find_session";
    else if (/article|content|resource|guide/.test(lower))
      intent = "find_content";

    // Extract skill entities from known synonyms
    for (const [canonical, variants] of Object.entries(SYNONYMS)) {
      if ([canonical, ...variants].some((v) => lower.includes(v))) {
        entities.push({ type: "skill", value: canonical });
      }
    }

    // Extract price filter
    const priceMatch = lower.match(/under\s+\$?(\d+)/);
    if (priceMatch) filters.maxPrice = parseInt(priceMatch[1]);

    // Extract rating filter
    const ratingMatch = lower.match(/(\d+(?:\.\d+)?)\s*\+?\s*star/);
    if (ratingMatch) filters.minRating = parseFloat(ratingMatch[1]);

    return { intent, entities, filters };
  }

  /**
   * Expand query terms with synonyms for broader matching.
   */
  static expandQuery(query: string): string {
    const terms = new Set<string>([query]);
    const lower = query.toLowerCase();

    for (const [canonical, variants] of Object.entries(SYNONYMS)) {
      if (
        lower.includes(canonical) ||
        variants.some((v) => lower.includes(v))
      ) {
        terms.add(canonical);
        variants.forEach((v) => terms.add(v));
      }
    }

    return Array.from(terms).join(" | ");
  }

  /**
   * Main semantic search: searches mentors, sessions, and content.
   */
  static async search(
    rawQuery: string,
    userId?: string,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const { filters: parsedFilters } = this.parseQuery(rawQuery);
    const mergedFilters = { ...parsedFilters, ...filters };
    const expandedQuery = this.expandQuery(rawQuery);

    const results: SearchResult[] = [];

    if (!mergedFilters.type || mergedFilters.type === "mentor") {
      const mentors = await this.searchMentors(
        rawQuery,
        expandedQuery,
        mergedFilters,
        userId,
      );
      results.push(...mentors);
    }

    if (!mergedFilters.type || mergedFilters.type === "session") {
      const sessions = await this.searchSessions(
        rawQuery,
        expandedQuery,
        mergedFilters,
      );
      results.push(...sessions);
    }

    // Sort by combined relevance + semantic score
    results.sort(
      (a, b) =>
        b.relevanceScore +
        b.semanticScore -
        (a.relevanceScore + a.semanticScore),
    );

    return results.slice(0, 20);
  }

  /**
   * Get autocomplete suggestions for a partial query.
   */
  static async getSuggestions(
    partialQuery: string,
  ): Promise<SearchSuggestion[]> {
    const suggestions: SearchSuggestion[] = [];

    // Autocomplete from mentor skills/names
    const result = await pool.query(
      `SELECT DISTINCT unnest(skills) AS term FROM mentors
       WHERE similarity(unnest(skills), $1) > 0.3
       LIMIT 5`,
      [partialQuery],
    );

    for (const row of result.rows) {
      suggestions.push({ text: row.term, type: "autocomplete" });
    }

    // Synonym expansions
    const lower = partialQuery.toLowerCase();
    for (const [canonical, variants] of Object.entries(SYNONYMS)) {
      if (variants.some((v) => v.startsWith(lower))) {
        suggestions.push({ text: canonical, type: "expansion" });
      }
    }

    return suggestions.slice(0, 8);
  }

  /**
   * Log a search query for personalization and analytics.
   */
  static async logSearch(
    userId: string | undefined,
    query: string,
    resultCount: number,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO search_logs (user_id, query, result_count, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId ?? null, query, resultCount],
    );
  }

  private static async searchMentors(
    rawQuery: string,
    expandedQuery: string,
    filters: SearchFilters,
    _userId?: string,
  ): Promise<SearchResult[]> {
    const params: any[] = [rawQuery, expandedQuery];
    let whereClause = `
      to_tsvector('english', m.name || ' ' || COALESCE(m.bio, '') || ' ' || array_to_string(COALESCE(m.skills, '{}'), ' '))
      @@ to_tsquery('english', $2)
      OR similarity(m.name || ' ' || COALESCE(m.bio, ''), $1) > 0.1`;

    if (filters.minRating) {
      params.push(filters.minRating);
      whereClause += ` AND m.average_rating >= $${params.length}`;
    }
    if (filters.maxPrice) {
      params.push(filters.maxPrice);
      whereClause += ` AND m.hourly_rate <= $${params.length}`;
    }

    const result = await pool.query(
      `SELECT m.id, m.name, m.bio, m.skills,
              ts_rank(
                to_tsvector('english', m.name || ' ' || COALESCE(m.bio, '') || ' ' || array_to_string(COALESCE(m.skills, '{}'), ' ')),
                to_tsquery('english', $2)
              ) AS rank,
              similarity(m.name || ' ' || COALESCE(m.bio, ''), $1) AS sim_score
       FROM mentors m
       WHERE ${whereClause}
       ORDER BY rank DESC, sim_score DESC
       LIMIT 10`,
      params,
    );

    return result.rows.map((row) => ({
      id: row.id,
      type: "mentor" as const,
      relevanceScore: parseFloat(row.rank) || 0,
      semanticScore: parseFloat(row.sim_score) || 0,
      matchedTerms: (row.skills || []).filter((s: string) =>
        rawQuery
          .toLowerCase()
          .split(" ")
          .some((q) => s.toLowerCase().includes(q)),
      ),
      snippet: row.bio ? row.bio.substring(0, 150) + "..." : row.name,
    }));
  }

  private static async searchSessions(
    rawQuery: string,
    expandedQuery: string,
    _filters: SearchFilters,
  ): Promise<SearchResult[]> {
    const result = await pool.query(
      `SELECT s.id, s.title, s.description,
              ts_rank(
                to_tsvector('english', COALESCE(s.title, '') || ' ' || COALESCE(s.description, '')),
                to_tsquery('english', $2)
              ) AS rank,
              similarity(COALESCE(s.title, '') || ' ' || COALESCE(s.description, ''), $1) AS sim_score
       FROM sessions s
       WHERE to_tsvector('english', COALESCE(s.title, '') || ' ' || COALESCE(s.description, ''))
             @@ to_tsquery('english', $2)
          OR similarity(COALESCE(s.title, '') || ' ' || COALESCE(s.description, ''), $1) > 0.1
       ORDER BY rank DESC
       LIMIT 10`,
      [rawQuery, expandedQuery],
    );

    return result.rows.map((row) => ({
      id: row.id,
      type: "session" as const,
      relevanceScore: parseFloat(row.rank) || 0,
      semanticScore: parseFloat(row.sim_score) || 0,
      matchedTerms: rawQuery
        .toLowerCase()
        .split(" ")
        .filter(
          (q) =>
            (row.title || "").toLowerCase().includes(q) ||
            (row.description || "").toLowerCase().includes(q),
        ),
      snippet: row.description
        ? row.description.substring(0, 150) + "..."
        : row.title,
    }));
  }
}
