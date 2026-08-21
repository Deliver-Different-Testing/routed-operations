import baseConfig from './playwright.config';
import { defineConfig } from '@playwright/test';

// Headed-specific overlay so `npm run test:e2e:headed` opens a chromium
// window that stays on screen long enough to watch. The base config
// keeps slowMo=0 so headless CI runs stay fast; this overlay only
// applies when the headed script is invoked.
export default defineConfig(baseConfig, {
  workers: 1,
  use: {
    ...baseConfig.use,
    headless: false,
    launchOptions: {
      slowMo: 400,
    },
  },
});
