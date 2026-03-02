import { type INode } from 'svgson';
/** Get all the colors used in the SVG node as a `Set` list. **/
export declare const getColorList: (node: INode) => Set<string>;
/** given a set of colors, orders them from dark to light. **/
export declare const orderDarkToLight: (colors: Set<string>) => string[];
/** checks if a string is a valid color. **/
export declare const isValidColor: (color?: string) => boolean;
/**
 * Creates a map of color replacements based on the base color and
 * the list of colors.
 *
 * Orders the list of colors from dark to light and replaces the darkest
 * color with the base color. Then uses the hue of the base color and
 * the material palette to find the most appropriate color for the rest
 * in the list.
 */
export declare const replacementMap: (baseColor: string, colors: Set<string>) => Map<string, string>;
//# sourceMappingURL=colors.d.ts.map