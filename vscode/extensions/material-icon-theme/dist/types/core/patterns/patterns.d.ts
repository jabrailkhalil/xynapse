import type { FileIcon } from '../models/icons/files/fileIcon';
import { type FileIconWithPatterns } from '../models/icons/patterns/patterns';
/**
 * Parses the raw file icons by applying the patterns.
 * A pattern helps to generate file names based on a key.
 *
 * @param rawFileIcons - The list of file icons without applied patterns.
 * @returns The list of file icons with applied patterns.
 */
export declare const parseByPattern: (rawFileIcons: FileIconWithPatterns) => FileIcon[];
//# sourceMappingURL=patterns.d.ts.map