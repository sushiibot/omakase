<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
	import * as NativeSelect from '$lib/ui/native-select';
	import type { RichData } from '../rich/blocks';
	import ReplyPanel from './reply-panel.svelte';
	import type { LiveBinding } from '../rich/live';

	// A few details the agent needs. Send posts one "Label: value" line per filled field as the
	// owner's message, so what is sent is exactly what was typed.
	let {
		data,
		reply,
		partial = false,
		live
	}: {
		data: RichData<'form'>;
		reply?: (text: string) => void;
		/** Still streaming: shown, never live (no `reply` either). */
		partial?: boolean;
		/** The stored block: what was sent from it shows on every device. */
		live?: LiveBinding;
	} = $props();
	const uid = $props.id();
	// A number input binds a number (or null when cleared), so values are read through `entry`.
	let values = $state<(string | number | null | undefined)[]>([]);
	const entry = (i: number): string => String(values[i] ?? '').trim();
	let localSent = $state<string | null>(null);
	// Answered on any device: the stored block says so, and this one stops sending too.
	const sent = $derived(live?.block.state.sent ?? localSent);
	let tried = $state(false);
	const disabled = $derived(!reply || sent !== null);
	const missing = $derived(data.fields.map((f, i) => !f.optional && !entry(i)));

	function submit(event: SubmitEvent) {
		event.preventDefault();
		tried = true;
		if (!reply || sent !== null || missing.some(Boolean)) return;
		const text = data.fields
			.map((f, i) => [f.label, entry(i)] as const)
			.filter(([, v]) => v)
			.map(([label, v]) => `${label}: ${v}`)
			.join('\n');
		localSent = text.replace(/\n/g, '; ');
		reply(text);
		live?.apply([{ op: 'sent', text: localSent.slice(0, 2000) }]);
	}
</script>

<ReplyPanel title={data.title} live={!!reply} {partial} {sent}>
	<form data-rich-control class="flex flex-col gap-3" onsubmit={submit} novalidate>
		{#each data.fields as field, i (i)}
			<div class="flex flex-col gap-1.5">
				<label for="{uid}-{i}" class="text-sm font-medium"
					>{field.label}{#if field.optional}{' '}<span class="font-normal text-muted-foreground"
							>(optional)</span
						>{/if}</label
				>
				{#if field.type === 'select'}
					<NativeSelect.Root data-rich-control id="{uid}-{i}" {disabled} bind:value={values[i]}>
						<NativeSelect.Option value="">Choose…</NativeSelect.Option>
						{#each field.options ?? [] as option, j (j)}<NativeSelect.Option value={option}
								>{option}</NativeSelect.Option
							>{/each}
					</NativeSelect.Root>
				{:else}
					<Input
						data-rich-control
						id="{uid}-{i}"
						type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
						placeholder={field.placeholder}
						maxlength={200}
						{disabled}
						aria-invalid={tried && missing[i] ? true : undefined}
						bind:value={values[i]}
					/>
				{/if}
				{#if tried && missing[i]}<span class="text-xs text-failed">Needed</span>{/if}
			</div>
		{/each}
		<Button
			data-rich-control
			type="submit"
			variant="secondary"
			size="sm"
			class="self-start"
			{disabled}>{data.submit ?? 'Send'}</Button
		>
	</form>
</ReplyPanel>
