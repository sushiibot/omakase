export function voiceProvider(provider: string): { name: string; shortName: string; key: string } {
	switch (provider) {
		case 'gemini':
			return { name: 'Google Gemini (direct)', shortName: 'Gemini', key: 'GEMINI_API_KEY' };
		case 'qwen':
			return {
				name: 'Alibaba DashScope (direct)',
				shortName: 'DashScope',
				key: 'DASHSCOPE_API_KEY + workspace'
			};
		case 'openai':
			return { name: 'OpenAI (direct)', shortName: 'OpenAI', key: 'OPENAI_REALTIME_API_KEY' };
		default:
			return { name: 'Direct provider', shortName: 'Provider', key: 'Provider API key' };
	}
}
