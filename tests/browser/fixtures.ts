import { test as base, expect } from '@playwright/test';

// Installed download managers may replace PDF responses with HTTP 204 in Chrome
// and Edge. Opt in only on affected test hosts; fetch the real authenticated
// response through Playwright's HTTP client without changing its bytes/headers.
export const test = base.extend<{ pdfTransport: void }>({
  pdfTransport: [
    async ({ context }, use) => {
      if (process.env.TEST_ISOLATE_PDF_TRANSPORT === 'true') {
        await context.route('**/api/builds/*/pdf', async (route) => {
          const response = await route.fetch();
          await route.fulfill({ response });
        });
      }
      await use();
    },
    { auto: true },
  ],
});
export { expect };
