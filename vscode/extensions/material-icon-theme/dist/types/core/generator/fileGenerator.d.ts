import type { Config } from '../models/icons/config';
import type { FileIcons } from '../models/icons/files/fileTypes';
import type { Manifest } from '../models/manifest';
/**
 * Get all file icons that can be used in this theme.
 *
 * @param fileIcons - The file icons to be used in the theme.
 * @param config - The configuration object for the icons.
 * @param manifest - The manifest object to be updated with the file icons.
 * @returns The updated manifest object with the file icons.
 */
export declare const loadFileIconDefinitions: (fileIcons: FileIcons, config: Config, manifest: Manifest) => Manifest;
/**
 * Generate the file icons with the specified color, opacity, and saturation.
 *
 * @param color - The color of the file icons.
 * @param opacity - The opacity of the file icons.
 * @param saturation - The saturation of the file icons.
 */
export declare const generateFileIcons: (color: string, opacity: number, saturation: number) => Promise<void>;
//# sourceMappingURL=fileGenerator.d.ts.map