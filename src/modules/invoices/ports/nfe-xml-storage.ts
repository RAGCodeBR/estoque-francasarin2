import type { NfeXmlFile } from '../domain/types';

export interface NfeXmlStorage {
  store(file: NfeXmlFile, fileHash: string): Promise<string>;
}
