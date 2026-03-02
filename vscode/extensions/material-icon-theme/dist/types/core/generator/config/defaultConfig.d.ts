import type { Config } from '../../models/icons/config';
import type { RecursivePartial } from '../../types/recursivePartial';
/**
 * The options control the generator and decide which icons are disabled or not.
 */
export declare const getDefaultConfig: () => Required<Config>;
/**
 * Fill in missing configuration values with the default values.
 *
 * @param config Configuration object
 * @returns New configuration object with default values
 */
export declare const padWithDefaultConfig: (config?: RecursivePartial<Config>) => Config;
//# sourceMappingURL=defaultConfig.d.ts.map