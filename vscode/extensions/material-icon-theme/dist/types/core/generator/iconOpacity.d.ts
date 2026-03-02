/**
 * Changes the opacity of all icons in the set.
 *
 * @param opacity - The opacity value to be applied to the icons.
 * @param filesAssociations - The file associations to be considered.
 */
export declare const setIconOpacity: (opacity: number, filesAssociations: Record<string, string>) => Promise<void>;
/**
 * Validate the opacity value.
 *
 * @param opacity - The opacity value to be validated.
 * @returns True if the opacity value is valid, false otherwise.
 */
export declare const validateOpacityValue: (opacity?: number) => boolean;
/**
 * Add or remove opacity from a given SVG string.
 *
 * @param svg - The SVG file as a string.
 * @param opacity - The opacity value to be applied.
 * @returns The updated SVG file with the applied opacity.
 */
export declare const updateSVGOpacity: (svg: string, opacity: number) => string;
//# sourceMappingURL=iconOpacity.d.ts.map