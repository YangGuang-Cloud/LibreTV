export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build' && process.platform === 'linux') {
    const { startServerMetricsCollector } = await import('./lib/server-metrics');
    startServerMetricsCollector();
  }
}
