// Prometheus text metrics: queue depth, running workers, job outcomes and job
// latency. Labels are the operation, the terminal state and a boundary code -
// never an id, a filename or a user.

const BUCKETS_SECONDS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600];

interface Histogram {
  counts: number[];
  sum: number;
  count: number;
}

export class Metrics {
  private readonly acceptedTotal = new Map<string, number>();
  private readonly outcomes = new Map<string, number>();
  private readonly rejections = new Map<string, number>();
  private readonly latency = new Map<string, Histogram>();

  accepted(operation: string): void {
    this.acceptedTotal.set(operation, (this.acceptedTotal.get(operation) ?? 0) + 1);
  }

  finished(operation: string, state: string, durationMs: number): void {
    const key = operation + "\u0000" + state;
    this.outcomes.set(key, (this.outcomes.get(key) ?? 0) + 1);
    let h = this.latency.get(operation);
    if (!h) {
      h = { counts: BUCKETS_SECONDS.map(() => 0), sum: 0, count: 0 };
      this.latency.set(operation, h);
    }
    const seconds = Math.max(0, durationMs) / 1000;
    BUCKETS_SECONDS.forEach((bound, i) => {
      if (seconds <= bound) h.counts[i] = (h.counts[i] ?? 0) + 1;
    });
    h.sum += seconds;
    h.count++;
  }

  rejected(code: string): void {
    this.rejections.set(code, (this.rejections.get(code) ?? 0) + 1);
  }

  render(gauges: { queueDepth: number; running: number; maxWorkers: number; maxQueue: number; quarantinedSlots?: number }): string {
    const lines: string[] = [];
    const gauge = (name: string, help: string, value: number) => {
      lines.push("# HELP " + name + " " + help, "# TYPE " + name + " gauge", name + " " + value);
    };
    gauge("office_engine_queue_depth", "Jobs accepted and waiting for a worker.", gauges.queueDepth);
    gauge("office_engine_running_jobs", "Jobs holding a worker.", gauges.running);
    gauge("office_engine_max_workers", "Configured worker pool size.", gauges.maxWorkers);
    gauge("office_engine_max_queue", "Configured queue bound.", gauges.maxQueue);
    gauge(
      "office_engine_quarantined_slots",
      "Worker slot uids permanently withheld because a process tree outlived the kill sweep.",
      gauges.quarantinedSlots ?? 0,
    );

    lines.push("# HELP office_engine_jobs_accepted_total Jobs accepted.", "# TYPE office_engine_jobs_accepted_total counter");
    for (const [op, n] of this.acceptedTotal) lines.push('office_engine_jobs_accepted_total{operation="' + op + '"} ' + n);

    lines.push("# HELP office_engine_jobs_total Jobs by terminal state.", "# TYPE office_engine_jobs_total counter");
    for (const [key, n] of this.outcomes) {
      const [op, state] = key.split("\u0000");
      lines.push('office_engine_jobs_total{operation="' + op + '",outcome="' + state + '"} ' + n);
    }

    lines.push("# HELP office_engine_rejections_total Submits refused before a job existed.", "# TYPE office_engine_rejections_total counter");
    for (const [code, n] of this.rejections) lines.push('office_engine_rejections_total{code="' + code + '"} ' + n);

    lines.push("# HELP office_engine_job_duration_seconds Job run time.", "# TYPE office_engine_job_duration_seconds histogram");
    for (const [op, h] of this.latency) {
      BUCKETS_SECONDS.forEach((bound, i) => {
        lines.push('office_engine_job_duration_seconds_bucket{operation="' + op + '",le="' + bound + '"} ' + (h.counts[i] ?? 0));
      });
      lines.push('office_engine_job_duration_seconds_bucket{operation="' + op + '",le="+Inf"} ' + h.count);
      lines.push('office_engine_job_duration_seconds_sum{operation="' + op + '"} ' + h.sum);
      lines.push('office_engine_job_duration_seconds_count{operation="' + op + '"} ' + h.count);
    }
    return lines.join("\n") + "\n";
  }
}
