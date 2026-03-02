import type { Config } from '../models/icons/config';
import type { FolderTheme } from '../models/icons/folders/folderTheme';
import type { Manifest } from '../models/manifest';
/**
 * Get the folder icon definitions as object.
 *
 * @param folderIcons - The folder icons to be used in the theme.
 * @param config - The configuration object for the icons.
 * @param manifest - The manifest object to be updated with the folder icons.
 * @returns The updated manifest object with the folder icons.
 */
export declare const loadFolderIconDefinitions: (folderIcons: FolderTheme[], config: Config, manifest: Manifest) => Manifest;
/**
 * Generate the folder icons with the specified color, opacity, and saturation.
 *
 * @param color - The color of the folder icons.
 * @param opacity - The opacity of the folder icons.
 * @param saturation - The saturation of the folder icons.
 */
export declare const generateFolderIcons: (color: string, opacity: number, saturation: number) => Promise<void>;
/**
 * Generate the folder icons with the specified color, opacity, and saturation.
 *
 * @param color - The color of the root folder icons.
 * @param opacity - The opacity of the root folder icons.
 * @param saturation - The saturation of the root folder icons.
 */
export declare const generateRootFolderIcons: (color: string, opacity: number, saturation: number) => Promise<void>;
//# sourceMappingURL=folderGenerator.d.ts.map