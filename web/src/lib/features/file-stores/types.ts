export interface FileStore {
	id: string;
	revision: number;
	name: string;
	endpoint: string;
	folders: { id?: string; path: string; writable: boolean }[];
	username: string;
	certificateSha256: string;
	enabled: boolean;
}
export type FileStoreInput = Omit<FileStore, 'id' | 'revision'> & {
	id?: string;
	revision?: number;
	password?: string;
};
