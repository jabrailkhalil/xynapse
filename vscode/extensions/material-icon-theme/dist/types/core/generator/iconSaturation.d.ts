/**
 * Changes saturation of all icons in the set.
 *
 * @param saturation - The saturation value to be applied to the icons.
 * @param filesAssociations - The file associations to be considered.
 */
export declare const setIconSaturation: (saturation: number, filesAssociations: Record<string, string>) => Promise<void>;
/**
 * Validate the saturation value.
 *
 * @param saturation - The saturation value to be validated.
 * @returns True if the saturation value is valid, false otherwise.
 */
export declare const validateSaturationValue: (saturation: number | undefined) => boolean;
/**
 * Adjust the saturation of a given SVG string.
 *
 * @param svg - The SVG file as a string.
 * @param saturation - The saturation value to be applied.
 * @returns The updated SVG file with the applied saturation.
 */
export declare const adjustSVGSaturation: (svg: string, saturation: number) => string;
//# sourceMappingURL=iconSaturation.d.ts.map