import { cloudFetch } from './cloud-client.js';
import { redactSecrets } from '../src/server/configuration.js';
export function progressReporter(id: string) {
  let phase = 'building';
  const logs: string[] = [];
  let pending = Promise.resolve();
  const secrets = () =>
    Object.fromEntries(
      Object.entries(process.env).filter(
        ([name, value]) => value && /(?:TOKEN|SECRET|PASSWORD|DEPLOY_HOOK)/.test(name),
      ),
    ) as Record<string, string>;
  const report = () => {
    pending = pending
      .catch(() => {})
      .then(async () => {
        await cloudFetch('jobs/' + id + '/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase, logs }),
        });
      });
    return pending;
  };
  const timer = setInterval(() => void report().catch(() => {}), 20_000);
  timer.unref();
  return {
    log(message: string) {
      for (const line of redactSecrets(message, secrets()).split('\n'))
        if (line.trim()) logs.push(line.slice(0, 2000));
      if (logs.length > 200) logs.splice(0, logs.length - 200);
    },
    async phase(value: string) {
      phase = value;
      await report();
    },
    async close() {
      clearInterval(timer);
      await report();
    },
    logs,
  };
}
