import { defineConfig } from '@playwright/test';

const port = Number(process.env.PANE_LAB_PORT ?? 4208);

export default defineConfig({
	testDir: '.',
	testMatch: '*.browser.ts',
	workers: 1,
	reporter: 'list',
	use: {
		baseURL: `http://localhost:${port}`,
		viewport: { width: 412, height: 915 },
		isMobile: true,
		hasTouch: true,
		channel: 'chromium'
	},
	webServer: {
		command: `PROTO=1 bun run build && PROTO=1 bun run preview --port ${port} --strictPort`,
		url: `http://localhost:${port}/interaction-lab`,
		timeout: 180_000,
		reuseExistingServer: false
	}
});
