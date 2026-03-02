import type { Config } from '../models/icons/config';
/**
 * Apply the configuration to the icons. But only if the configuration has changed.
 * If the affectedConfig is not set then all icons will be updated.
 *
 * @param config - The new configuration that customizes the icons and the manifest.
 * @param oldConfig - The previous configuration to compare changes.
 */
export declare const applyConfigToIcons: (config: Config, oldConfig: Config) => Promise<void>;
//# sourceMappingURL=applyConfigToIcons.d.ts.map