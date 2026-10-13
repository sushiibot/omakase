import Body from './page-body.svelte';
import Header from './page-header.svelte';
import Intro from './page-intro.svelte';

export { measureClass, type PageMeasure } from './page-body.svelte';
export {
	Header,
	Intro,
	Body,
	//
	Header as PageHeader,
	Intro as PageIntro,
	Body as PageBody
};
