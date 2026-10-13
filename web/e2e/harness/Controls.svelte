<script lang="ts">
	import { Button } from '$lib/ui/button';
	let clicks = $state(0);
</script>

<section aria-label="Control examples" class="flex flex-col items-start gap-4">
	<Button onclick={() => clicks++}>Default action</Button>
	<Button variant="outline" size="icon" aria-label="Icon action" onclick={() => clicks++}>+</Button>
	<Button size="icon-lg" aria-label="Field icon action">+</Button>
	<Button size="lg">Prominent action</Button>
	<Button href="#enabled">Enabled link</Button>
	<Button href="#disabled" disabled>Disabled link</Button>
	<Button disabled>Disabled action</Button>
	<Button variant="outline" class="rounded-full">Round action</Button>
	<p role="status">Activated {clicks} times</p>
</section>
