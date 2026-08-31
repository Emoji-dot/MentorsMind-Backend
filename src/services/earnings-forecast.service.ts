import { logger } from "../utils/logger.utils";

export interface ForecastPoint {
  date: Date;
  predictedEarnings: number;
  lowerBound: number;
  upperBound: number;
}

export interface EarningsForecast {
  mentorId: string;
  period: "monthly" | "quarterly" | "yearly";
  forecast: ForecastPoint[];
  confidence: number;
  assumptions: string[];
  scenarios: {
    pessimistic: number;
    realistic: number;
    optimistic: number;
  };
}

export interface EarningsGoal {
  mentorId: string;
  targetAmount: number;
  period: "monthly" | "quarterly" | "yearly";
  deadline: Date;
}

export interface HistoricalEarning {
  date: Date;
  amount: number;
  sessionCount: number;
}

export class EarningsForecastService {
  async generateForecast(
    mentorId: string,
    period: "monthly" | "quarterly" | "yearly",
    historicalData: HistoricalEarning[],
  ): Promise<EarningsForecast> {
    logger.info(
      `Generating ${period} earnings forecast for mentor ${mentorId}`,
    );

    if (historicalData.length === 0) {
      return this.buildEmptyForecast(mentorId, period);
    }

    const avgEarnings = this.calculateAverage(
      historicalData.map((d) => d.amount),
    );
    const trend = this.calculateTrend(historicalData);
    const seasonalFactors = this.calculateSeasonalFactors(historicalData);
    const confidence = this.calculateConfidence(historicalData);

    const forecastPoints = this.buildForecastPoints(
      period,
      avgEarnings,
      trend,
      seasonalFactors,
    );

    const realistic = forecastPoints.reduce(
      (s, p) => s + p.predictedEarnings,
      0,
    );

    const forecast: EarningsForecast = {
      mentorId,
      period,
      forecast: forecastPoints,
      confidence,
      assumptions: [
        "Based on historical session frequency and rates",
        "Assumes consistent availability",
        "Market demand signals factored in via trend analysis",
        `Seasonal adjustment applied (${seasonalFactors.length} data points)`,
      ],
      scenarios: {
        pessimistic: realistic * 0.7,
        realistic,
        optimistic: realistic * 1.35,
      },
    };

    logger.info(
      `Forecast generated for mentor ${mentorId}: realistic=${realistic.toFixed(2)}, confidence=${confidence}`,
    );
    return forecast;
  }

  private buildForecastPoints(
    period: "monthly" | "quarterly" | "yearly",
    avgEarnings: number,
    trend: number,
    seasonalFactors: number[],
  ): ForecastPoint[] {
    const periodMap = { monthly: 1, quarterly: 3, yearly: 12 };
    const months = periodMap[period];
    const points: ForecastPoint[] = [];
    const now = new Date();

    for (let i = 1; i <= months; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthIndex = date.getMonth();
      const seasonal = seasonalFactors[monthIndex] ?? 1;
      const predicted = Math.max(0, (avgEarnings + trend * i) * seasonal);
      const margin = predicted * 0.2;

      points.push({
        date,
        predictedEarnings: Math.round(predicted * 100) / 100,
        lowerBound: Math.round((predicted - margin) * 100) / 100,
        upperBound: Math.round((predicted + margin) * 100) / 100,
      });
    }

    return points;
  }

  private calculateAverage(values: number[]): number {
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  private calculateTrend(data: HistoricalEarning[]): number {
    if (data.length < 2) return 0;
    const sorted = [...data].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const n = sorted.length;
    const first = sorted.slice(0, Math.floor(n / 2));
    const second = sorted.slice(Math.floor(n / 2));
    const avgFirst = this.calculateAverage(first.map((d) => d.amount));
    const avgSecond = this.calculateAverage(second.map((d) => d.amount));
    return (avgSecond - avgFirst) / Math.floor(n / 2);
  }

  private calculateSeasonalFactors(data: HistoricalEarning[]): number[] {
    const monthlyTotals = new Array(12).fill(0);
    const monthlyCounts = new Array(12).fill(0);

    data.forEach(({ date, amount }) => {
      const m = new Date(date).getMonth();
      monthlyTotals[m] += amount;
      monthlyCounts[m]++;
    });

    const monthlyAvgs = monthlyTotals.map((total, i) =>
      monthlyCounts[i] > 0 ? total / monthlyCounts[i] : 0,
    );
    const overallAvg =
      monthlyAvgs.filter((v) => v > 0).reduce((s, v) => s + v, 0) /
        monthlyAvgs.filter((v) => v > 0).length || 1;

    return monthlyAvgs.map((avg) => (avg > 0 ? avg / overallAvg : 1));
  }

  private calculateConfidence(data: HistoricalEarning[]): number {
    if (data.length >= 12) return 0.85;
    if (data.length >= 6) return 0.7;
    if (data.length >= 3) return 0.55;
    return 0.4;
  }

  private buildEmptyForecast(
    mentorId: string,
    period: "monthly" | "quarterly" | "yearly",
  ): EarningsForecast {
    return {
      mentorId,
      period,
      forecast: [],
      confidence: 0,
      assumptions: ["Insufficient historical data for forecasting"],
      scenarios: { pessimistic: 0, realistic: 0, optimistic: 0 },
    };
  }

  evaluateGoal(
    goal: EarningsGoal,
    forecast: EarningsForecast,
  ): { onTrack: boolean; gap: number; recommendation: string } {
    const projected = forecast.scenarios.realistic;
    const gap = goal.targetAmount - projected;
    const onTrack = projected >= goal.targetAmount;

    const recommendation = onTrack
      ? "You are on track to meet your earnings goal."
      : `Increase session frequency or rates by approximately $${gap.toFixed(2)} to meet your goal.`;

    return { onTrack, gap, recommendation };
  }
}

export const earningsForecastService = new EarningsForecastService();
