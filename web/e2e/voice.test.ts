import { expect, test, type BrowserContext } from '@playwright/test';
import { mockRecognition, recognize } from './live-transcription';
import { axe, checkScreen, fixtureApp, push } from './helpers';
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
	await expect
		.poll(async () =>
			Number(
				await page
					.getByRole('meter', { name: 'Microphone level', exact: true })
					.getAttribute('aria-valuenow')
			)
		)
		.toBeGreaterThan(0);
	await page.screenshot({ path: '/tmp/sushii-microphone-meter.png' });
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
	const captions = page.locator('[data-voice-message]').last();
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
	await expect(captions.locator('[data-message-text]')).toHaveClass(/italic/);
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
	await expect(captions.locator('[data-message-text]')).not.toHaveClass(/italic/);
	await expect(captions.getByText('Voice', { exact: true })).toBeVisible();
	await expect(captions.getByText('Voice', { exact: true })).toBeVisible();

	connection.send(JSON.stringify({ type: 'agent', state: 'working' }));
	await expect(page.getByRole('region', { name: 'Voice call' })).toContainText('Working');
	await expect(page.getByRole('region', { name: 'Voice call' })).toContainText('Find my notes.');
	await expect(page.locator('[data-channel-activity]')).toHaveCount(0);
	await expect(page.locator('[data-routed-sheet]')).toHaveCount(0);
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
	await expect(page.getByText('API: Alibaba DashScope (direct).', { exact: false })).toBeVisible();
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
	await mockRecognition(context);
	await context.addInitScript(() =>
		localStorage.setItem(
			'voice:preferences',
			JSON.stringify({ mode: 'turns', model: 'hexgrad/kokoro-82m', voice: 'bella', volume: 0.35 })
		)
	);
	await page.addInitScript(() => {
		const tracks: MediaStreamTrack[] = [];
		const sessionChanges: string[] = [];
		const gains: GainNode[] = [];
		Object.assign(window, {
			testTracks: tracks,
			testSessionChanges: sessionChanges,
			testGains: gains
		});
		let type = 'auto';
		Object.defineProperty(navigator, 'audioSession', {
			value: {
				get type() {
					return type;
				},
				set type(next) {
					type = next;
					sessionChanges.push(next);
				}
			},
			configurable: true
		});
		const getMic = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		navigator.mediaDevices.getUserMedia = async (constraints) => {
			const stream = await getMic(constraints);
			tracks.push(stream.getAudioTracks()[0]!);
			return stream;
		};
		const gain = AudioContext.prototype.createGain;
		AudioContext.prototype.createGain = function () {
			const node = gain.call(this);
			gains.push(node);
			return node;
		};
		const Capture = window.AudioWorkletNode;
		window.AudioWorkletNode = class extends Capture {
			constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
				super(context, name, options);
				(window as unknown as { testCapture: AudioWorkletNode }).testCapture = this;
			}
		};
	});
	const speechModels = [
		{
			id: 'qwen/qwen-audio-3.0-tts-flash',
			name: 'Qwen Flash TTS',
			curated: 'Recommended',
			description: '',
			voices: ['Cherry'],
			price: { unit: 'characters', input: 0.000015, output: 0 }
		},
		{
			id: 'hexgrad/kokoro-82m',
			name: 'Kokoro 82M',
			curated: null,
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
	let previews = 0;
	await context.route('**/api/voice/preview', async (route) => {
		previews++;
		expect(route.request().postDataJSON()).toEqual({
			model: 'qwen/qwen-audio-3.0-tts-flash',
			voice: 'Cherry',
			delivery: ''
		});
		const wav = Buffer.alloc(44 + 16000 * 2 * 3);
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
		await route.fulfill({ body: wav, contentType: 'audio/wav' });
	});
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
	await expect(page.getByLabel('Speaking voice', { exact: true })).toHaveValue('Cherry');
	await expect(page.getByLabel('Voice output', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Preview Cherry', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
	await page.getByRole('button', { name: 'Preview Cherry', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible();
	expect(previews).toBe(1);
	await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
	await expect(page.getByRole('region', { name: 'Curated speech models' })).not.toContainText(
		'Kokoro'
	);
	await expect(
		page.getByText('$0.5 text input / $6 audio output per 1M tokens', { exact: true }).first()
	).toBeVisible();
	await expect(page.getByText('Speech API: OpenRouter', { exact: false })).toBeVisible();
	await page.getByText('Browse all OpenRouter speech models', { exact: true }).click();
	await page.getByRole('button', { name: /Kokoro 82M/ }).click();
	await page.getByLabel('Speaking voice', { exact: true }).selectOption('bella');
	await page.getByRole('searchbox', { name: 'Search speech models' }).fill('future/');
	await page.getByRole('button', { name: /New Speech Model/ }).click();
	await expect(page.getByLabel('Speaking voice', { exact: true })).toHaveValue('new-voice');
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(await axe(page)).toEqual([]);
	await page.screenshot({ path: '/tmp/speech-models-desktop.png' });
	await page.setViewportSize({ width: 320, height: 740 });
	await expect(page.getByRole('button', { name: 'Close Voice chat', exact: true })).toBeVisible();
	await checkScreen(page);
	await page.screenshot({ path: '/tmp/speech-models-mobile.png' });
	await page.getByRole('button', { name: 'Start voice chat' }).click();
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeHidden();
	expect(selectedUrl).toContain('mode=turns');
	expect(selectedUrl).toContain('model=future%2Fspeech-model');
	await recognize(page, 'Check my calender');
	const provisional = page.locator('[data-voice-message]').last().locator('[data-message-text]');
	await expect(provisional).toHaveText('Check my calender');
	await expect(provisional).toHaveClass(/italic/);
	await recognize(page, 'Check my calendar');
	await expect(provisional).toHaveText('Check my calendar');
	await page.evaluate(async () => {
		const capture = (window as unknown as { testCapture: AudioWorkletNode }).testCapture;
		await (capture.context as AudioContext).suspend();
		const feed = (amplitude: number) =>
			capture.port.dispatchEvent(
				new MessageEvent('message', {
					data: new Int16Array(320).fill(amplitude).buffer
				})
			);
		for (let i = 0; i < 10; i++) feed(1000);
		for (let i = 0; i < 60; i++) feed(0);
	});
	await expect.poll(() => packets.filter((p) => p.type === 'commit').length).toBe(1);
	await expect(page.getByRole('region', { name: 'Voice call' })).toContainText('Transcribing');
	expect(
		await page.evaluate(
			() => (window as unknown as { testTracks: MediaStreamTrack[] }).testTracks[0]!.readyState
		)
	).toBe('ended');
	expect(
		await page.evaluate(() =>
			(window as unknown as { testSessionChanges: string[] }).testSessionChanges.at(-1)
		)
	).toBe('playback');
	expect(
		await page.evaluate(() =>
			(window as unknown as { testGains: GainNode[] }).testGains.some(
				(gain) => gain.gain.value !== 0
			)
		)
	).toBe(false);
	await expect(page.getByRole('button', { name: 'Send now', exact: true })).toHaveCount(0);
	expect(
		await page.evaluate(
			() => (window as unknown as { testCapture: AudioWorkletNode }).testCapture.context.state
		)
	).toBe('suspended');
	connection.send(
		JSON.stringify({
			type: 'transcript',
			role: 'user',
			text: 'Check my calendar',
			final: true,
			replace: true
		})
	);
	connection.send(
		JSON.stringify({ type: 'linked', userId: 'voice-request', assistantId: 'voice-work' })
	);
	await push(
		page,
		'user',
		{
			key: 'voice-request',
			text: 'Check my calendar',
			uploadIds: [],
			at: new Date().toISOString()
		},
		1
	);
	await expect(
		page.locator('[data-message-text]').filter({ hasText: 'Check my calendar' })
	).toHaveCount(1);
	connection.send(JSON.stringify({ type: 'phase', state: 'working' }));
	connection.send(JSON.stringify({ type: 'agent', state: 'working' }));
	await push(page, 'snapshot', {
		turnId: 'voice-work',
		view: {
			turnId: 'voice-work',
			startedAt: Date.now(),
			lines: [
				{
					id: 'search-1',
					name: 'search',
					summary: 'Searching calendar for a free afternoon',
					state: 'run'
				}
			],
			toolCount: 1,
			text: ''
		}
	});
	await expect(page.getByRole('region', { name: 'Voice call' })).toContainText(
		'Searching calendar for a free afternoon'
	);
	await push(page, 'delta', { turnId: 'voice-work', offset: 0, text: 'Your calendar is clear.' });
	connection.send(
		JSON.stringify({
			type: 'transcript',
			role: 'assistant',
			text: 'Your calendar is clear.',
			final: true,
			replace: true
		})
	);
	await expect(
		page.locator('[data-message-text]').filter({ hasText: 'Your calendar is clear.' })
	).toHaveCount(1);
	const ordered = await page.locator('[data-message-id]').allTextContents();
	expect(ordered.findIndex((t) => t.includes('Check my calendar'))).toBeLessThan(
		ordered.findIndex((t) => t.includes('Your calendar is clear.'))
	);
	await push(
		page,
		'approval',
		{
			nonce: 'voice-approval',
			view: {
				tool: 'send_email',
				agentId: 'main',
				agentName: 'Main',
				fields: [{ key: 'to', value: 'dentist@example.com', kind: 'single', max: 200 }]
			}
		},
		2
	);
	await expect(page.getByRole('region', { name: 'Voice call' })).toContainText('Approval needed');
	await page.getByRole('button', { name: 'Review voice request in chat' }).click();
	await expect(page).toHaveURL(/approve=voice-approval/);
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeHidden();
	await push(page, 'approval_resolved', { nonce: 'voice-approval', decision: 'deny' }, 3);
	await push(page, 'turn_final', {
		turnId: 'voice-work',
		outcome: 'done',
		summary: { durationMs: 100, toolCount: 1 }
	});
	connection.send(JSON.stringify({ type: 'phase', state: 'synthesizing' }));
	connection.send(JSON.stringify({ type: 'agent', state: 'done' }));
	await expect(page.getByRole('region', { name: 'Voice call' })).toContainText('Preparing voice');
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
	await expect(page.getByRole('region', { name: 'Voice call' })).toContainText('Listening');
	expect(
		await page.evaluate(
			() => (window as unknown as { testTracks: MediaStreamTrack[] }).testTracks[1]!.readyState
		)
	).toBe('live');
	await page.getByRole('button', { name: 'Voice call details' }).click();
	await expect(page.getByRole('button', { name: 'Send now', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Send now', exact: true }).click();
	await expect.poll(() => packets.filter((p) => p.type === 'commit').length).toBe(2);
	await page.getByRole('button', { name: 'Back to chat' }).click();
	await page
		.getByRole('region', { name: 'Voice call', exact: true })
		.getByRole('button', { name: 'End call' })
		.click();
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice:preferences')!));
	expect(saved.model).toBe('future/speech-model');
	expect(saved.voice).toBe('new-voice');
	expect(saved.mode).toBe('turns');
	expect(saved.volume).toBeUndefined();
	expect(
		await page.evaluate(() =>
			(window as unknown as { testSessionChanges: string[] }).testSessionChanges.at(-1)
		)
	).toBe('auto');
});

test('expressive delivery follows previews and calls; streaming playback acknowledges frames', async ({
	page,
	context
}) => {
	await withVoice(context);
	await context.route('**/api/voice/speech-models', (route) =>
		route.fulfill({
			json: {
				configured: true,
				updatedAt: new Date().toISOString(),
				models: [
					{
						id: 'elevenlabs/eleven-v4-turbo',
						name: 'Eleven v4 Turbo',
						description: '',
						voices: ['george'],
						curated: 'Premium',
						price: { unit: 'characters', input: 0.0001, output: 0 },
						capabilities: { expression: 'tags', streaming: true }
					},
					{
						id: 'plain/speech',
						name: 'Plain voice',
						description: '',
						voices: ['default'],
						curated: 'Alternative',
						price: { unit: 'characters', input: 0, output: 0 },
						capabilities: { expression: null, streaming: false }
					}
				]
			}
		})
	);
	const previews: any[] = [];
	await context.route('**/api/voice/preview', (route) => {
		previews.push(route.request().postDataJSON());
		return route.fulfill({ status: 502, json: { error: 'Test preview unavailable' } });
	});
	let socket: any;
	let url = '';
	const packets: any[] = [];
	await page.routeWebSocket('**/api/voice/connect**', (ws) => {
		socket = ws;
		url = ws.url();
		ws.onMessage((data) => packets.push(JSON.parse(String(data))));
		ws.send(JSON.stringify({ type: 'ready', inputRate: 16000 }));
	});
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
	await page.getByRole('button', { name: 'Talk in turns', exact: true }).click();
	const delivery = page.getByLabel('Voice delivery', { exact: true });
	await delivery.fill('Warm, curious, relaxed pace');
	await page.getByRole('button', { name: 'Preview george', exact: true }).click();
	await expect.poll(() => previews.length).toBe(1);
	expect(previews[0].delivery).toBe('Warm, curious, relaxed pace');
	await page.getByRole('button', { name: /Plain voice · Alternative/ }).click();
	await expect(delivery).toHaveCount(0);
	await page.getByRole('button', { name: /Eleven v4 Turbo · Premium/ }).click();
	await expect(delivery).toHaveValue('Warm, curious, relaxed pace');
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(await axe(page)).toEqual([]);
	await page.screenshot({ path: '/tmp/sushii-expressive-voice-desktop.png' });
	await page.setViewportSize({ width: 320, height: 740 });
	await checkScreen(page);
	await page.screenshot({ path: '/tmp/sushii-expressive-voice-mobile.png' });
	await page.getByRole('button', { name: 'Start voice chat', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Voice chat' })).toBeHidden();
	expect(new URL(url).searchParams.get('delivery')).toBe('Warm, curious, relaxed pace');
	socket.send(
		JSON.stringify({
			type: 'audio',
			audio: Buffer.alloc(4800).toString('base64'),
			sampleRate: 24000,
			playbackId: 37
		})
	);
	await expect
		.poll(() => packets.some((p) => p.type === 'playback_done' && p.id === 37))
		.toBe(true);
	await page.getByRole('button', { name: 'End call', exact: true }).click();
});

test('read aloud uses saved speech settings without a microphone and supports stop, failure and retry', async ({
	page,
	context
}) => {
	await withVoice(context);
	await context.route('**/api/chat/history**', (route) =>
		route.fulfill({
			json: {
				items: [
					{
						type: 'assistant',
						id: 'read-reply',
						at: new Date().toISOString(),
						text: 'Your **calendar** is clear.\n\nEnjoy your afternoon.',
						attachments: [],
						tools: [],
						files: []
					}
				],
				before: null
			}
		})
	);
	await context.route('**/api/voice/speech-models', (route) =>
		route.fulfill({
			json: {
				configured: true,
				updatedAt: new Date().toISOString(),
				models: [
					{
						id: 'elevenlabs/eleven-v4-turbo',
						name: 'Eleven v4 Turbo',
						voices: ['george'],
						description: '',
						curated: 'Premium',
						price: { unit: 'characters', input: 0.0001, output: 0 },
						capabilities: { expression: 'tags', streaming: true }
					}
				]
			}
		})
	);
	await page.addInitScript(() => {
		localStorage.setItem(
			'voice:preferences',
			JSON.stringify({
				version: 2,
				mode: 'turns',
				model: 'elevenlabs/eleven-v4-turbo',
				voice: 'george',
				delivery: 'Warm and relaxed'
			})
		);
		Object.assign(window, { microphoneRequests: 0 });
		navigator.mediaDevices.getUserMedia = async () => {
			(window as unknown as { microphoneRequests: number }).microphoneRequests++;
			throw new Error('Read-aloud must not request the microphone');
		};
	});
	let socket: any;
	const packets: any[] = [];
	let connections = 0;
	await page.routeWebSocket('**/api/voice/connect**', (ws) => {
		socket = ws;
		connections++;
		const query = new URL(ws.url()).searchParams;
		expect(query.get('mode')).toBe('read');
		expect(query.get('model')).toBe('elevenlabs/eleven-v4-turbo');
		expect(query.get('voice')).toBe('george');
		expect(query.get('delivery')).toBe('Warm and relaxed');
		ws.onMessage((raw) => packets.push(JSON.parse(String(raw))));
		ws.send(JSON.stringify({ type: 'ready' }));
	});
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
	await expect.poll(() => packets.filter((p) => p.type === 'speak').length).toBe(1);
	expect(packets[0].text).toBe('Your calendar is clear.\n\nEnjoy your afternoon.');
	await expect(page.getByText('Preparing voice…', { exact: true })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Voice call', exact: true })).toHaveCount(0);
	socket.send(
		JSON.stringify({
			type: 'audio',
			audio: Buffer.alloc(4800).toString('base64'),
			sampleRate: 24000,
			playbackId: 1
		})
	);
	await expect.poll(() => packets.some((p) => p.type === 'playback_done' && p.id === 1)).toBe(true);
	await expect(page.getByText('Reading aloud', { exact: true })).toBeVisible();
	await checkScreen(page);
	await page.screenshot({ path: '/tmp/sushii-read-aloud-mobile.png' });
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(await axe(page)).toEqual([]);
	await page.screenshot({ path: '/tmp/sushii-read-aloud-desktop.png' });
	socket.send(JSON.stringify({ type: 'turn_done' }));
	await expect(page.getByRole('button', { name: 'Read aloud', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
	await expect.poll(() => connections).toBe(2);
	await page.getByRole('button', { name: 'Stop reading aloud', exact: true }).click();
	await expect(page.getByText('Preparing voice…', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
	await expect.poll(() => connections).toBe(3);
	socket.send(
		JSON.stringify({ type: 'error', message: 'Voice is unavailable. Try another model.' })
	);
	await expect(page.getByRole('alert')).toContainText('Voice is unavailable');
	await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
	await expect.poll(() => connections).toBe(4);
	await page.getByRole('button', { name: 'Stop reading aloud', exact: true }).click();
	expect(
		await page.evaluate(
			() => (window as unknown as { microphoneRequests: number }).microphoneRequests
		)
	).toBe(0);
});
