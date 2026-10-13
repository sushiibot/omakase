<script lang="ts">
	import { Button } from '$lib/ui/button';
	let clicks = $state(0);
</script>

<section aria-label="Control examples" class="flex flex-col items-start gap-6 p-4">
	<Button onclick={() => clicks++}>Default action</Button>
	<Button variant="outline" size="icon" aria-label="Icon action" onclick={() => clicks++}>+</Button>
	<Button size="sm">Small action</Button>
	<Button size="icon-sm" aria-label="Small icon action">+</Button>
	<Button size="lg">Prominent action</Button>
	<Button size="icon-lg" aria-label="Prominent icon action">+</Button>
	<Button href="#enabled">Enabled link</Button>
	<Button href="#disabled" disabled>Disabled link</Button>
	<Button disabled>Disabled action</Button>
	<Button variant="outline">Next action</Button>
	<div class="flex w-64 flex-col" aria-label="Contiguous rows">
		<Button
			variant="ghost"
			class="justify-start any-pointer-coarse:h-11 any-pointer-coarse:after:hidden"
			>First row</Button
		>
		<Button
			variant="ghost"
			class="justify-start any-pointer-coarse:h-11 any-pointer-coarse:after:hidden"
			>Second row</Button
		>
	</div>
	<div class="flex gap-2">
		<Button variant="outline" size="icon" aria-label="Earlier neighbour">+</Button>
		<Button variant="outline" size="icon" aria-label="Later neighbour">+</Button>
	</div>
	<div class="flex gap-2 any-pointer-coarse:gap-4">
		<Button variant="outline">Deny</Button>
		<Button>Approve</Button>
	</div>
	<p role="status">Activated {clicks} times</p>
</section>
