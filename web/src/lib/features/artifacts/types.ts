export interface ArtifactSummary {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	conversationId: string;
	version: number;
}
export interface Artifact extends ArtifactSummary {
	content: string;
}
export interface ArtifactList {
	artifacts: ArtifactSummary[];
	truncated: boolean;
}
