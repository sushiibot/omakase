import type { BrowserContext, Page } from '@playwright/test';
export async function mockRecognition(context: BrowserContext) {
	await context.addInitScript(() => {
		class MockRecognition {
			continuous = false;
			interimResults = false;
			lang = '';
			onresult: ((event: unknown) => void) | null = null;
			onend: (() => void) | null = null;
			onerror: ((event: unknown) => void) | null = null;
			start() {
				(window as unknown as { testRecognition: MockRecognition }).testRecognition = this;
			}
			abort() {}
		}
		Object.assign(window, { SpeechRecognition: MockRecognition });
	});
}
export async function recognize(page: Page, text: string) {
	await page.evaluate((text) => {
		const recognition = (
			window as unknown as { testRecognition: { onresult: ((event: unknown) => void) | null } }
		).testRecognition;
		recognition.onresult?.({ results: [{ 0: { transcript: text }, isFinal: false }] });
	}, text);
}
