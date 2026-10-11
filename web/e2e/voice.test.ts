import { expect, test, type BrowserContext } from '@playwright/test';
import { axe, checkScreen, fixtureApp } from './helpers';
test.use({
	launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
	permissions: ['microphone']
});
async function withVoice(context: BrowserContext, configured = true) {
	await fixtureApp(context, { override: '' });
	await context.addInitScript(() =>
		localStorage.setItem('voice:preferences', JSON.stringify({ mode: 'live' }))
	);
	await context.route('**/api/voice/speech-models', (route) =>
		route.fulfill({ json: { models: [], configured: false, updatedAt: new Date().toISOString() } })
	);
	await context.route('**/api/voice/models', (route) =>
		route.fulfill({
			json: {
				models: [
					{
						id: 'qwen',
						name: 'Qwen Omni 3.8 Flash Realtime',
						provider: 'qwen',
						description: 'Multimodal realtime model. This app uses microphone audio only.',
						model: 'qwen3.8-omni-flash-realtime',
						inputRate: 16000,
						audioInputUsd: 0.93,
						audioOutputUsd: 1.87,
						configured
					},
					...[
						[
							'qwen-omni-3.5-flash',
							'Qwen Omni 3.5 Flash Realtime',
							'qwen3.5-omni-flash-realtime',
							4.5,
							17.7
						],
						[
							'qwen-omni-3.5-plus',
							'Qwen Omni 3.5 Plus Realtime',
							'qwen3.5-omni-plus-realtime',
							16.5,
							62
						],
						[
							'qwen-audio-3.1-plus',
							'Qwen Audio 3.1 Plus Realtime',
							'qwen-audio-3.1-realtime-plus',
							6.4,
							24
						],
						[
							'qwen-audio-3.0-plus',
							'Qwen Audio 3.0 Plus Realtime',
							'qwen-audio-3.0-realtime-plus',
							6.4,
							24
						],
						[
							'qwen-audio-3.0-flash',
							'Qwen Audio 3.0 Flash Realtime',
							'qwen-audio-3.0-realtime-flash',
							0.93,
							1.87
						]
					].map(([id, name, model, audioInputUsd, audioOutputUsd]) => ({
						id,
						name,
						model,
						audioInputUsd,
						audioOutputUsd,
						configured,
						provider: 'qwen',
						inputRate: 16000,
						description: String(id).startsWith('qwen-audio-')
							? 'Dedicated full-duplex speech model. Accepts audio and text.'
							: 'Multimodal realtime model. This app uses microphone audio only.'
					}))
				],
				defaultProvider: configured ? 'qwen' : null
			}
		})
	);
}
test('voice keeps Dictate available and explains missing server credentials', async ({
	page,
	context
}) => {
	await withVoice(context, false);
	await page.goto('/chat');
	await expect(page.getByRole('button', { name: 'Dictate' })).toBeEnabled();
	await expect(
		page.getByRole('banner').getByRole('button', { name: 'Voice chat', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
	await expect(
		page.getByText('Voice needs a provider API key on the server.', { exact: false })
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start voice chat' })).toBeDisabled();
	await checkScreen(page);
});
test('PCM streams in both directions, interruption stops playback, mute and end release the mic', async ({
	page,
	context
}) => {
	await withVoice(context);
	let connection: any;
	const packets: any[] = [];
	await page.routeWebSocket('**/api/voice/connect**', (ws) => {
		connection = ws;
		ws.onMessage((data) => packets.push(JSON.parse(String(data))));
		ws.send(JSON.stringify({ type: 'ready', inputRate: 16000 }));
	});
	await page.addInitScript(() => {
		const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		navigator.mediaDevices.getUserMedia = async (constraints) => {
			const stream = await real(constraints);
			(window as unknown as { voiceTrack: MediaStreamTrack }).voiceTrack =
				stream.getAudioTracks()[0]!;
			return stream;
		};
	});
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
	await page.getByRole('button', { name: 'Start voice chat' }).click();
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeHidden();
	await expect(
		page
			.getByRole('region', { name: 'Voice call', exact: true })
			.getByRole('button', { name: 'Mute microphone' })
	).toBeEnabled();
	await expect.poll(() => packets.some((m) => m.type === 'audio')).toBe(true);
	connection.send(
		JSON.stringify({
			type: 'audio',
			audio: Buffer.alloc(48000).toString('base64'),
			sampleRate: 24000
		})
	);
	await expect(page.getByText('Speaking', { exact: false })).toBeVisible();
	connection.send(JSON.stringify({ type: 'interrupted' }));
	await expect(page.getByText('Listening', { exact: false })).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeHidden();
	const captions = page.getByRole('region', { name: 'Voice captions', exact: true });
	const transcript = (text: string, extra = {}) =>
		connection.send(
			JSON.stringify({
				type: 'transcript',
				role: 'user',
				text,
				final: false,
				itemId: 'turn-1',
				...extra
			})
		);
	transcript('Check my ');
	await expect(captions.locator('[data-message-text]')).toHaveClass(/italic/);
	await expect(page.getByText('Say hi to your agent.', { exact: true })).toBeHidden();
	transcript('calender');
	await expect(captions).toContainText('Check my calender');
	transcript('Check my calendar', { interim: true, replace: true });
	await expect(captions).toContainText('Check my calendar');
	await expect(captions).not.toContainText('calender');
	connection.send(JSON.stringify({ type: 'turn_done' }));
	transcript('Check my calendar.', { final: true, replace: true });
	await expect(captions).toContainText('Check my calendar.');
	await expect(captions).not.toContainText('calender');
	await expect(captions.locator('[data-message-text]')).not.toHaveClass(/italic/);
	await expect(captions.locator('[data-message-text]')).toHaveClass(/bg-primary/);
	await expect(captions.getByText('Voice', { exact: true })).toBeVisible();
	transcript('Find my', { interim: true, itemId: 'turn-2' });
	transcript('Find my notes', { interim: true, itemId: 'turn-2' });
	await expect(captions).toContainText('Find my notes');
	transcript('Find my notes.', { final: true, itemId: 'turn-2' });
	await expect(captions).toContainText('Find my notes.');
	connection.send(
		JSON.stringify({ type: 'transcript', role: 'assistant', text: 'I will check.', final: false })
	);
	await expect(captions.getByText('I will check.', { exact: true })).toHaveClass(/italic/);
	connection.send(
		JSON.stringify({
			type: 'transcript',
			role: 'assistant',
			text: 'I will check.',
			final: true,
			replace: true
		})
	);
	connection.send(JSON.stringify({ type: 'turn_done' }));
	await expect(captions.getByText('I will check.', { exact: true })).not.toHaveClass(/italic/);
	await expect(captions.getByText('Voice', { exact: true })).toHaveCount(2);
	await page.getByRole('button', { name: 'Hide voice captions' }).click();
	await expect(captions).toBeHidden();
	await page.getByRole('button', { name: 'Show voice captions' }).click();
	await expect(captions).toBeVisible();

	connection.send(JSON.stringify({ type: 'agent', state: 'working' }));
	await expect(
		page.getByText('Sushii is working · tools and approvals appear in chat', { exact: false })
	).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: '/tmp/voice-captions-desktop.png' });
	await page.setViewportSize({ width: 320, height: 740 });
	const callBounds = await page
		.getByRole('region', { name: 'Voice call', exact: true })
		.boundingBox();
	const composerBounds = await page
		.getByRole('textbox', { name: 'Message', exact: true })
		.boundingBox();
	expect(callBounds!.y).toBeGreaterThan(740 / 2);
	expect(callBounds!.y + callBounds!.height).toBeLessThanOrEqual(composerBounds!.y);
	await page.screenshot({ path: '/tmp/voice-captions-mobile.png' });
	await checkScreen(page);
	await page.getByRole('button', { name: 'Mute microphone' }).click();
	expect(
		await page.evaluate(
			() => (window as unknown as { voiceTrack: MediaStreamTrack }).voiceTrack.enabled
		)
	).toBe(false);
	await page.getByRole('banner').getByRole('button', { name: 'Voice chat:', exact: false }).click();
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeVisible();
	await page.getByRole('button', { name: 'Back to chat' }).click();
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeHidden();
	await expect(page.getByRole('button', { name: 'Dictate' })).toBeDisabled();
	await expect(
		page
			.getByRole('region', { name: 'Voice call', exact: true })
			.getByRole('button', { name: 'End call' })
	).toBeVisible();
	await checkScreen(page);
	await page.getByRole('button', { name: 'End call' }).click();
	await expect(page.getByRole('button', { name: 'Dictate' })).toBeEnabled();
	expect(
		await page.evaluate(
			() => (window as unknown as { voiceTrack: MediaStreamTrack }).voiceTrack.readyState
		)
	).toBe('ended');
});
test('leaving the app ends the call and releases the microphone', async ({ page, context }) => {
	await withVoice(context);
	await page.routeWebSocket('**/api/voice/connect**', (ws) =>
		ws.send(JSON.stringify({ type: 'ready', inputRate: 16000 }))
	);
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
	await page.getByRole('button', { name: 'Start voice chat' }).click();
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeHidden();
	await expect(
		page
			.getByRole('region', { name: 'Voice call', exact: true })
			.getByRole('button', { name: 'Mute microphone' })
	).toBeEnabled();
	await page.evaluate(() => {
		Object.defineProperty(document, 'hidden', { value: true, configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect(page.getByRole('region', { name: 'Voice call', exact: true })).toBeHidden();
	await expect(page.getByRole('button', { name: 'Dictate' })).toBeEnabled();
});

test('voice model choices explain Audio and Omni and connect the selected model', async ({
	page,
	context
}) => {
	await withVoice(context);
	let selectedUrl = '';
	await page.routeWebSocket('**/api/voice/connect**', (ws) => {
		selectedUrl = ws.url();
		ws.send(JSON.stringify({ type: 'ready', inputRate: 16000 }));
	});
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
	const picker = page.getByLabel('Voice model', { exact: true });
	await expect(picker.locator('option')).toHaveCount(6);
	await expect(picker).toHaveValue('qwen');
	await expect(page.getByText('Multimodal realtime model.', { exact: false })).toBeVisible();
	await picker.selectOption('qwen-audio-3.1-plus');
	await expect(
		page.getByText('Dedicated full-duplex speech model.', { exact: false })
	).toBeVisible();
	await expect(page.getByText('Audio: $6.4 input / $24 output', { exact: false })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(await axe(page)).toEqual([]);
	await page.screenshot({ path: '/tmp/voice-models-desktop.png' });
	await page.setViewportSize({ width: 320, height: 740 });
	await checkScreen(page);
	await page.setViewportSize({ width: 320, height: 740 });
	await expect(await axe(page)).toEqual([]);
	await page.screenshot({ path: '/tmp/voice-models-mobile.png' });
	await page.getByRole('button', { name: 'Start voice chat' }).click();
	await expect.poll(() => selectedUrl).toContain('provider=qwen-audio-3.1-plus');
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeHidden();
	await page
		.getByRole('region', { name: 'Voice call', exact: true })
		.getByRole('button', { name: 'End call' })
		.click();
});

test('turn-based voice discovers any speech model, shows billing units, persists selection and interrupts playback', async ({
	page,
	context
}) => {
	await withVoice(context);
	const speechModels = [
		{
			id: 'hexgrad/kokoro-82m',
			name: 'Kokoro 82M',
			curated: 'Budget',
			description: '',
			voices: ['heart', 'bella'],
			price: { unit: 'characters', input: 0.00000062, output: 0 }
		},
		{
			id: 'google/gemini-3.8-flash-lite-tts',
			name: 'Gemini Flash Lite TTS',
			curated: 'Value candidate',
			description: '',
			voices: ['Kore'],
			price: { unit: 'tokens', input: 0.0000005, output: 0.000006 }
		},
		{
			id: 'future/speech-model',
			name: 'New Speech Model',
			curated: null,
			description: '',
			voices: ['new-voice'],
			price: { unit: 'characters', input: 0.000002, output: 0 }
		}
	];
	await context.route('**/api/voice/speech-models', (route) =>
		route.fulfill({
			json: { models: speechModels, configured: true, updatedAt: new Date().toISOString() }
		})
	);
	let connection: any;
	const packets: any[] = [];
	let selectedUrl = '';
	await page.routeWebSocket('**/api/voice/connect**', (ws) => {
		connection = ws;
		selectedUrl = ws.url();
		ws.onMessage((data) => packets.push(JSON.parse(String(data))));
		ws.send(JSON.stringify({ type: 'ready', inputRate: 16000 }));
	});
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
	await page.getByRole('button', { name: 'Talk in turns', exact: true }).click();
	await expect(page.getByText('$0.62 / 1M characters', { exact: true }).first()).toBeVisible();
	await expect(
		page.getByText('$0.5 text input / $6 audio output per 1M tokens', { exact: true }).first()
	).toBeVisible();
	await page.getByLabel('Speaking voice', { exact: true }).selectOption('bella');
	await page.getByText('Browse all OpenRouter speech models', { exact: true }).click();
	await page.getByRole('searchbox', { name: 'Search speech models' }).fill('future/');
	await page.getByRole('button', { name: /New Speech Model/ }).click();
	await expect(page.getByLabel('Speaking voice', { exact: true })).toHaveValue('new-voice');
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(await axe(page)).toEqual([]);
	await page.screenshot({ path: '/tmp/speech-models-desktop.png' });
	await page.setViewportSize({ width: 320, height: 740 });
	await checkScreen(page);
	await page.screenshot({ path: '/tmp/speech-models-mobile.png' });
	await page.getByRole('button', { name: 'Start voice chat' }).click();
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeHidden();
	expect(selectedUrl).toContain('mode=turns');
	expect(selectedUrl).toContain('model=future%2Fspeech-model');
	await page.getByRole('button', { name: 'Send voice turn', exact: true }).click();
	await expect.poll(() => packets.some((p) => p.type === 'commit')).toBe(true);
	await expect(page.getByRole('button', { name: 'Working…' })).toBeDisabled();
	connection.send(JSON.stringify({ type: 'agent', state: 'working' }));
	const wav = Buffer.alloc(44 + 16000 * 2 * 10);
	wav.write('RIFF');
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(16000, 24);
	wav.writeUInt32LE(32000, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write('data', 36);
	wav.writeUInt32LE(wav.length - 44, 40);
	connection.send(JSON.stringify({ type: 'audio_encoded', audio: wav.toString('base64') }));
	await page.getByRole('button', { name: 'Stop speaking', exact: true }).click();
	await expect.poll(() => packets.some((p) => p.type === 'interrupt')).toBe(true);
	connection.send(JSON.stringify({ type: 'turn_done' }));
	await expect(page.getByRole('button', { name: 'Send voice turn', exact: true })).toBeEnabled();
	await page
		.getByRole('region', { name: 'Voice call', exact: true })
		.getByRole('button', { name: 'End call' })
		.click();
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice:preferences')!));
	expect(saved.model).toBe('future/speech-model');
	expect(saved.voice).toBe('new-voice');
	expect(saved.mode).toBe('turns');
});
