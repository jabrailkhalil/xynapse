import type { CustomClone, FolderIconClone, LanguageIconClone } from '../../../models/icons/config';
import type { Manifest } from '../../../models/manifest';
export declare enum Variant {
    Base = 0,
    Open = 1,
    Light = 2,
    LightOpen = 3
}
export declare enum Type {
    Folder = 0,
    File = 1
}
export type IconData = {
    type: Type;
    path: string;
    variant: Variant;
};
export type CloneData = IconData & {
    name: string;
    color: string;
    inConfigPath: string;
    base: IconData;
};
/** checks if a `CustomClone` configuration is a `FolderIconClone` */
export declare const isFolder: (clone: CustomClone) => clone is FolderIconClone;
/** checks if a `CustomClone` configuration is a `LanguageIconClone` */
export declare const isLanguage: (clone: CustomClone) => clone is LanguageIconClone;
/**
 * get cloning information from configuration
 * @param cloneOpts - The clone configuration.
 * @param manifest - The current configuration of the extension.
 * @param subFolder - The subfolder where the cloned icons will be stored.
 * @param hash - The current hash being applied to the icons.
 * @param ext - The file extension for the cloned icons
 */
export declare const getCloneData: (cloneOpts: CustomClone, manifest: Manifest, subFolder: string, hash: string, ext?: string) => CloneData[] | undefined;
/**
 * Removes the clones folder if it exists
 * and creates a new one if `keep` is true
 *
 * @param keep whether to keep the folder after clearing it.
 */
export declare const clearCloneFolder: (keep?: boolean) => Promise<void>;
//# sourceMappingURL=cloneData.d.ts.map