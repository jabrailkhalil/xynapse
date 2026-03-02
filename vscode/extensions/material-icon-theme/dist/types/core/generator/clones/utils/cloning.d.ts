import { type INode } from 'svgson';
/**
 * Recursively walks through an SVG node tree and its children,
 * calling a callback on each node.
 *
 * @param node - The SVG node to traverse.
 * @param callback - The callback function to call on each node.
 * @param filter - Whether to filter nodes with 'data-mit-no-recolor' attribute.
 */
export declare const traverse: (node: INode, callback: (node: INode) => void, filter?: boolean) => void;
/**
 * Reads an icon from the file system and returns its content.
 *
 * @param path - The path to the icon file.
 * @param hash - The hash to be replaced in the path if the file is not found.
 * @returns A promise that resolves to the content of the icon file.
 */
export declare const readIcon: (path: string, hash: string) => Promise<string>;
/**
 * Clones an icon and changes its colors according to the clone options.
 *
 * @param path - The path to the icon file.
 * @param color - The color to replace in the icon.
 * @param hash - The hash to be replaced in the path if the file is not found.
 * @returns A promise that resolves to the content of the cloned icon.
 */
export declare const cloneIcon: (path: string, color: string, hash?: string) => Promise<string>;
/**
 * Gets the style attribute of an SVG node if it exists.
 *
 * @param node - The SVG node to get the style attribute from.
 * @returns The style attribute as an object.
 */
export declare const getStyle: (node: INode) => Record<string, string>;
/**
 * Converts object to css style string.
 *
 * @param css - The style attribute as an object.
 * @returns The style attribute as a string.
 */
export declare const stringifyStyle: (css: Record<string, string>) => string;
/**
 * Replaces colors in an SVG node using a replacement map.
 *
 * @param node - The SVG node to replace colors in.
 * @param replacements - The map of colors to replace.
 */
export declare const replaceColors: (node: INode, replacements: Map<string, string>) => void;
/**
 * Creates a clone manifest with empty light object.
 *
 * @returns A manifest object with empty light object.
 */
export declare const createCloneManifest: () => import("../../..").Manifest;
//# sourceMappingURL=cloning.d.ts.map