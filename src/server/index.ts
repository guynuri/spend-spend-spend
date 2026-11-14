import type { AppEnv } from './env';
import { app } from './app';

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppEnv>;
