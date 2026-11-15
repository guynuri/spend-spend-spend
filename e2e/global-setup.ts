import { rmSync } from 'node:fs';
export default function globalSetup() {
  rmSync('e2e/.state', { recursive: true, force: true });
}
