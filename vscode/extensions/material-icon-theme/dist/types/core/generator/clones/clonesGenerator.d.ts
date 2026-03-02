import type { Config } from '../../models/icons/config';
import type { FileIcons } from '../../models/icons/files/fileTypes';
import type { FolderTheme } from '../../models/icons/folders/folderTheme';
import type { LanguageIcon } from '../../models/icons/languages/languageIdentifier';
import type { Manifest } from '../../models/manifest';
/**
 * Creates custom icons by cloning already existing icons and changing
 * their colors, based on the user's provided configurations.
 *
 * @param manifest - The current configuration of the extension.
 * @param config - The new configuration that customizes the icons and the manifest.
 * @returns A promise that resolves to the updated manifest with custom clones.
 */
export declare const customClonesIcons: (manifest: Manifest, config: Config) => Promise<Manifest>;
export declare const generateConfiguredFileIconClones: (iconsList: FileIcons, manifest: Manifest) => Promise<void>;
export declare const generateConfiguredFolderIconClones: (iconsList: FolderTheme[], manifest: Manifest) => Promise<void>;
export declare const generateConfiguredLanguageIconClones: (iconsList: LanguageIcon[], manifest: Manifest) => Promise<void>;
/**
 * Checks if there are any custom clones to be created.
 *
 * @param config - The new configuration that customizes the icons and the manifest.
 * @returns True if there are custom clones to be created, false otherwise.
 */
export declare const hasCustomClones: (config: Config) => boolean;
//# sourceMappingURL=clonesGenerator.d.ts.map