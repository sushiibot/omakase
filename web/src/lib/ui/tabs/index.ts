// app: stock tab parts plus the swipe pager (ux-guidelines.md#tabs-swipes-and-scroll-ownership)
import Root from './tabs.svelte';
import Content from './tabs-content.svelte';
import List from './tabs-list.svelte';
import Trigger from './tabs-trigger.svelte';

export { Root, List, Trigger, Content };
export { default as SwipeableTabs } from './swipeable-tabs.svelte';
export type { SwipeableTab } from './swipeable-tabs.svelte';
export { default as Tabs } from './tabs.svelte';
export { default as TabsContent } from './tabs-content.svelte';
export { default as TabsList, tabsListVariants, type TabsListVariant } from './tabs-list.svelte';
export { default as TabsTrigger } from './tabs-trigger.svelte';
