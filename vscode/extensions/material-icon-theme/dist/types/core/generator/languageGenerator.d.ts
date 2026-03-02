import type { Config } from '../models/icons/config';
import type { LanguageIcon } from '../models/icons/languages/languageIdentifier';
import type { Manifest } from '../models/manifest';
/**
 * Get all language icons that can be used in this theme.
 *
 * @param languageIcons - The language icons to be used in the theme.
 * @param config - The configuration object for the icons.
 * @param manifest - The manifest object to be updated with the language icons.
 * @returns The updated manifest object with the language icons.
 */
export declare const loadLanguageIconDefinitions: (languageIcons: LanguageIcon[], config: Config, manifest: Manifest) => Manifest;
//# sourceMappingURL=languageGenerator.d.ts.map