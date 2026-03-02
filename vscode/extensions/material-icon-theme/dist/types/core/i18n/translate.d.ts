import type { Translation } from '../models/i18n/translation';
/** Initialize the translations */
export declare const initTranslations: (language: string) => Promise<void>;
/**
 * We look up the matching translation in the translation files.
 * If we cannot find a matching key in the file we use the fallback.
 * With optional parameters you can configure both the translations
 * and the fallback (required for testing purposes).
 * */
export declare const getTranslationValue: (key: string, translations?: Translation, fallback?: Translation) => string | undefined;
/**
 * The instant method is required for the translate pipe.
 * It helps to translate a word instantly.
 */
export declare const translate: (key: string, ...variables: string[]) => string;
/**
 * The replace function will replace the current placeholder with the
 * data parameter from the translation. You can give it one or more optional
 * parameters ('variables').
 */
export declare const replace: (value?: string, ...variables: string[]) => string;
//# sourceMappingURL=translate.d.ts.map