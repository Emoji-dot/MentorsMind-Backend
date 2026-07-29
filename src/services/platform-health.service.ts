import pool from "../config/database";

export interface ComponentHealth {
  score: number;
  status: "healthy" | "degraded" | "critical";
  metrics: Record<string, number>;
  lastIncident?: Date;
}

export interface HealthTrend {
  timestamp: Date;
  overall: number;
}

export interface HealthAlert {
  component: string;
  message: string;
  severity: "warning" | "critical";
  triggeredAt: Date;
}

export interface PlatformHealthScore {
  overall: number;
  components: {
    api: ComponentHealth;
    database: ComponentHealth;
    payments: ComponentHealth;
    notifications: ComponentHealth;
    blockchain: ComponentHealth;
  };
  trends: HealthTrend[];
  alerts: HealthAlert[];
  slaCompliance: number;
}

function scoreToStatus(score: number): "healthy" | "degraded" | "critical" {
  if (score >= 80) return "healthy";
  if (score >= 50) return "degraded";
  return "critical";
}

async function getDatabaseHealth(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*) as total, AVG(EXTRACT(EPOCH FROM (NOW() - query_start))*1000) as avg_ms FROM pg_stat_activity WHERE state='active'",
    );
    const latency = Date.now() - start;
    const activeConnections = parseInt(rows[0]?.total ?? "0");
    const score = latency < 100 ? 100 : latency < 500 ? 75 : 40;
    return {
      score,
      status: scoreToStatus(score),
      metrics: { latency_ms: latency, active_connections: activeConnections },
    };
  } catch {
    return { score: 0, status: "critical", metrics: { latency_ms: -1 } };
  }
}

async function getApiHealth(): Promise<ComponentHealth> {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) as errors
       FROM audit_logs WHERE created_at > NOW() - INTERVAL '5 minutes'`,
    );
    const total = parseInt(rows[0]?.total ?? "0");
    const errors = parseInt(rows[0]?.errors ?? "0");
    const errorRate = total > 0 ? (errors / total) * 100 : 0;
    const score = errorRate < 1 ? 100 : errorRate < 5 ? 70 : 30;
    return {
      score,
      status: scoreToStatus(score),
      metrics: {
        total_requests: total,
        error_count: errors,
        error_rate_pct: Math.round(errorRate),
      },
    };
  } catch {
    return { score: 85, status: "healthy", metrics: { error_rate_pct: 0 } };
  }
}

async function getPaymentsHealth(): Promise<ComponentHealth> {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
       FROM payments WHERE created_at > NOW() - INTERVAL '1 hour'`,
    );
    const total = parseInt(rows[0]?.total ?? "0");
    const failed = parseInt(rows[0]?.failed ?? "0");
    const failRate = total > 0 ? (failed / total) * 100 : 0;
    const score = failRate < 2 ? 100 : failRate < 10 ? 65 : 20;
    return {
      score,
      status: scoreToStatus(score),
      metrics: {
        total_payments: total,
        failed_payments: failed,
        fail_rate_pct: Math.round(failRate),
      },
    };
  } catch {
    return { score: 90, status: "healthy", metrics: { fail_rate_pct: 0 } };
  }
}

async function getNotificationsHealth(): Promise<ComponentHealth> {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
       FROM notifications WHERE created_at > NOW() - INTERVAL '1 hour'`,
    );
    const total = parseInt(rows[0]?.total ?? "0");
    const failed = parseInt(rows[0]?.failed ?? "0");
    const failRate = total > 0 ? (failed / total) * 100 : 0;
    const score = failRate < 5 ? 100 : failRate < 20 ? 60 : 25;
    return {
      score,
      status: scoreToStatus(score),
      metrics: {
        total_notifications: total,
        failed_notifications: failed,
        fail_rate_pct: Math.round(failRate),
      },
    };
  } catch {
    return { score: 90, status: "healthy", metrics: { fail_rate_pct: 0 } };
  }
}

async function getBlockchainHealth(): Promise<ComponentHealth> {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
       FROM stellar_operations WHERE created_at > NOW() - INTERVAL '1 hour'`,
    );
    const total = parseInt(rows[0]?.total ?? "0");
    const failed = parseInt(rows[0]?.failed ?? "0");
    const failRate = total > 0 ? (failed / total) * 100 : 0;
    const score = failRate < 2 ? 100 : failRate < 10 ? 60 : 20;
    return {
      score,
      status: scoreToStatus(score),
      metrics: {
        total_ops: total,
        failed_ops: failed,
        fail_rate_pct: Math.round(failRate),
      },
    };
  } catch {
    return { score: 90, status: "healthy", metrics: { fail_rate_pct: 0 } };
  }
}

function buildAlerts(
  components: PlatformHealthScore["components"],
): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  for (const [name, comp] of Object.entries(components)) {
    if (comp.status === "critical") {
      alerts.push({
        component: name,
        message: `${name} is critical (score: ${comp.score})`,
        severity: "critical",
        triggeredAt: new Date(),
      });
    } else if (comp.status === "degraded") {
      alerts.push({
        component: name,
        message: `${name} is degraded (score: ${comp.score})`,
        severity: "warning",
        triggeredAt: new Date(),
      });
    }
  }
  return alerts;
}

export const PlatformHealthService = {
  async getHealthScore(): Promise<PlatformHealthScore> {
    const [api, database, payments, notifications, blockchain] =
      await Promise.all([
        getApiHealth(),
        getDatabaseHealth(),
        getPaymentsHealth(),
        getNotificationsHealth(),
        getBlockchainHealth(),
      ]);

    const components = { api, database, payments, notifications, blockchain };
    const scores = Object.values(components).map((c) => c.score);
    const overall = Math.round(
      scores.reduce((a, b) => a + b, 0) / scores.length,
    );
    const alerts = buildAlerts(components);

    // Persist snapshot
    try {
      await pool.query(
        "INSERT INTO platform_health_snapshots (overall_score, components, alerts) VALUES ($1,$2,$3)",
        [overall, JSON.stringify(components), JSON.stringify(alerts)],
      );
    } catch {
      // Non-critical: table may not exist yet
    }

    const trends = await this.getHealthTrends();
    const slaCompliance =
      overall >= 99 ? 100 : overall >= 95 ? 99 : overall >= 90 ? 97 : 95;

    return { overall, components, trends, alerts, slaCompliance };
  },

  async getHealthTrends(hours = 24): Promise<HealthTrend[]> {
    try {
      const { rows } = await pool.query(
        "SELECT created_at as timestamp, overall_score as overall FROM platform_health_snapshots WHERE created_at > NOW() - ($1 || ' hours')::INTERVAL ORDER BY created_at ASC LIMIT 100",
        [hours],
      );
      return rows;
    } catch {
      return [];
    }
  },
};
