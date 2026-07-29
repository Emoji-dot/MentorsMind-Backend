import axios from "axios";
import { logger } from "../utils/logger.utils";

export interface CodeIssue {
  line: number;
  column: number;
  severity: "info" | "warning" | "error" | "critical";
  rule: string;
  message: string;
  suggestion: string;
}

export interface Suggestion {
  type: string;
  description: string;
  example?: string;
}

export interface CodeReview {
  submissionId: string;
  language: string;
  issues: CodeIssue[];
  qualityScore: number;
  securityScore: number;
  suggestions: Suggestion[];
  aiReview: string;
  plagiarismScore: number;
}

export interface ReviewHistory {
  id: string;
  submissionId: string;
  reviewedAt: Date;
  review: CodeReview;
}

export class CodeReviewService {
  private readonly openaiApiKey = process.env.OPENAI_API_KEY;
  private readonly reviewHistory: ReviewHistory[] = [];

  async reviewCode(
    submissionId: string,
    code: string,
    language: string,
  ): Promise<CodeReview> {
    logger.info(`Starting code review for submission ${submissionId}`);

    const [issues, aiReview, plagiarismScore] = await Promise.all([
      this.runStaticAnalysis(code, language),
      this.getAiReview(code, language),
      this.checkPlagiarism(code),
    ]);

    const qualityScore = this.calculateQualityScore(issues);
    const securityScore = this.calculateSecurityScore(issues);
    const suggestions = this.generateSuggestions(issues, language);

    const review: CodeReview = {
      submissionId,
      language,
      issues,
      qualityScore,
      securityScore,
      suggestions,
      aiReview,
      plagiarismScore,
    };

    this.reviewHistory.push({
      id: `review-${Date.now()}`,
      submissionId,
      reviewedAt: new Date(),
      review,
    });

    logger.info(
      `Code review completed for submission ${submissionId}: quality=${qualityScore}, security=${securityScore}`,
    );
    return review;
  }

  private async runStaticAnalysis(
    code: string,
    language: string,
  ): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];
    const lines = code.split("\n");

    lines.forEach((line, index) => {
      // Security: detect eval usage
      if (/\beval\s*\(/.test(line)) {
        issues.push({
          line: index + 1,
          column: line.indexOf("eval") + 1,
          severity: "critical",
          rule: "no-eval",
          message: "Use of eval() is a security risk",
          suggestion: "Replace eval() with safer alternatives",
        });
      }
      // Security: hardcoded secrets
      if (/(password|secret|api_key)\s*=\s*['"][^'"]+['"]/i.test(line)) {
        issues.push({
          line: index + 1,
          column: 1,
          severity: "critical",
          rule: "no-hardcoded-secrets",
          message: "Hardcoded secret detected",
          suggestion: "Use environment variables for sensitive values",
        });
      }
      // Style: console.log in production code
      if (/console\.(log|debug)\s*\(/.test(line) && language === "javascript") {
        issues.push({
          line: index + 1,
          column: line.search(/console/) + 1,
          severity: "warning",
          rule: "no-console",
          message: "Avoid console.log in production code",
          suggestion: "Use a proper logging library",
        });
      }
    });

    return issues;
  }

  private async getAiReview(code: string, language: string): Promise<string> {
    if (!this.openaiApiKey) {
      return "AI review unavailable: OPENAI_API_KEY not configured";
    }
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content:
                "You are an expert code reviewer. Provide concise, actionable feedback.",
            },
            {
              role: "user",
              content: `Review this ${language} code for quality, security, and best practices:\n\n${code}`,
            },
          ],
          max_tokens: 500,
        },
        { headers: { Authorization: `Bearer ${this.openaiApiKey}` } },
      );
      return response.data.choices[0].message.content;
    } catch (err) {
      logger.error("AI review failed", err);
      return "AI review temporarily unavailable";
    }
  }

  private async checkPlagiarism(code: string): Promise<number> {
    // Placeholder: returns a score 0-100 (0 = original, 100 = plagiarized)
    const codeLength = code.trim().length;
    return codeLength < 50 ? 0 : Math.random() * 20; // stub
  }

  private calculateQualityScore(issues: CodeIssue[]): number {
    const deductions = issues.reduce((sum, issue) => {
      const weights = { info: 1, warning: 5, error: 15, critical: 25 };
      return sum + weights[issue.severity];
    }, 0);
    return Math.max(0, 100 - deductions);
  }

  private calculateSecurityScore(issues: CodeIssue[]): number {
    const securityIssues = issues.filter((i) =>
      ["no-eval", "no-hardcoded-secrets"].includes(i.rule),
    );
    const deductions = securityIssues.reduce((sum, issue) => {
      const weights = { info: 2, warning: 10, error: 25, critical: 40 };
      return sum + weights[issue.severity];
    }, 0);
    return Math.max(0, 100 - deductions);
  }

  private generateSuggestions(
    issues: CodeIssue[],
    language: string,
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];

    if (issues.some((i) => i.severity === "critical")) {
      suggestions.push({
        type: "security",
        description: "Address all critical security issues before deployment",
      });
    }
    if (issues.some((i) => i.rule === "no-console")) {
      suggestions.push({
        type: "best-practice",
        description: `Use a structured logger instead of console statements in ${language}`,
        example: 'import { logger } from "./utils/logger";',
      });
    }

    return suggestions;
  }

  getReviewHistory(submissionId?: string): ReviewHistory[] {
    if (submissionId) {
      return this.reviewHistory.filter((r) => r.submissionId === submissionId);
    }
    return this.reviewHistory;
  }
}

export const codeReviewService = new CodeReviewService();
