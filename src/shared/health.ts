export type HealthIssue = {
  id: string;
  severity: 'warning' | 'error';
  message: string;
  action: string;
  firstSeen: string;
  lastSeen: string;
  resolvedAt?: string;
};
export type HealthReport = {
  checkedAt: string;
  checks: {
    id: string;
    state: 'optional' | 'configured' | 'verified' | 'attention';
    detail: string;
  }[];
  issues: HealthIssue[];
  worker?: {
    requests: number;
    errors: number;
    cpuP50Ms: number;
    cpuP95Ms: number;
    cpuP99Ms: number;
    from: string;
    to: string;
  };
  metricsUnavailable?: string;
};
