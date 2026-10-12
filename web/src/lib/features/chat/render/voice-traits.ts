// Google's published prebuilt-voice descriptions: https://ai.google.dev/gemini-api/docs/speech-generation
const gemini: Record<string, string> = {
	Zephyr: 'Bright',
	Puck: 'Upbeat',
	Charon: 'Informative',
	Kore: 'Firm',
	Fenrir: 'Excitable',
	Leda: 'Youthful',
	Orus: 'Firm',
	Aoede: 'Breezy',
	Callirrhoe: 'Easy-going',
	Autonoe: 'Bright',
	Enceladus: 'Breathy',
	Iapetus: 'Clear',
	Umbriel: 'Easy-going',
	Algieba: 'Smooth',
	Despina: 'Smooth',
	Erinome: 'Clear',
	Algenib: 'Gravelly',
	Rasalgethi: 'Informative',
	Laomedeia: 'Upbeat',
	Achernar: 'Soft',
	Alnilam: 'Firm',
	Schedar: 'Even',
	Gacrux: 'Mature',
	Pulcherrima: 'Forward',
	Achird: 'Friendly',
	Zubenelgenubi: 'Casual',
	Vindemiatrix: 'Gentle',
	Sadachbia: 'Lively',
	Sadaltager: 'Knowledgeable',
	Sulafat: 'Warm'
};
export function voiceTrait(model: string, voice: string): string | undefined {
	return model.startsWith('google/gemini-') ? gemini[voice] : undefined;
}
