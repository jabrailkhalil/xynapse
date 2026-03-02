/**
 * Get the nested properties of an object.
 * This solution is lighter than the lodash get-version.
 * Source: http://stackoverflow.com/a/6491621/6942210
 */
export declare const get: <T>(obj: Object, path: string) => T | undefined;
/**
 * Set a value for a nested object property.
 * @param obj Object
 * @param path Properties as string e.g. `'a.b.c'`
 * @param value Value to be set for the given property
 * Source: https://stackoverflow.com/a/13719799/6942210
 */
export declare const set: (obj: {
    [key: string]: any;
}, path: string | string[], value: unknown) => void;
/**
 * Merges given objects recursively.
 *
 * @param objects Provide the objects that should be merged.
 * @returns A new object that is the result of the merge.
 */
export declare const merge: <T extends Record<string, unknown>>(...objects: (T | undefined | null)[]) => T;
//# sourceMappingURL=object.d.ts.map