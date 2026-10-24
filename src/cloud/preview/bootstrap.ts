import { Buffer } from 'buffer';

// Some shared renderer dependencies inspect Node globals while their modules load.
// Initialize the private browser sandbox before importing that dependency graph.
(globalThis as any).Buffer = Buffer;
(globalThis as any).process = {
  env: { NODE_ENV: 'production' },
  platform: 'browser',
  arch: 'browser',
  versions: { node: 'browser' },
  cwd: () => '/preview',
};
void import('./host.js');
