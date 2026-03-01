import {
  AssistantUnrolled,
  XynapseProperties,
} from "@xynapse/config-yaml";
import fetch, { Response } from "node-fetch";
import OpenAI from "openai";

/**
 * Interface for OpenAI client options with assistant models
 */
interface OpenAIClientOptions extends Record<string, any> {
  /**
   * Models from the assistant configuration
   */
  models: AssistantUnrolled["models"];

  /**
   * Optional organization ID
   */
  organizationId?: string | null;

  /**
   * Whether to always use the Xynapse-managed proxy for model requests
   */
  alwaysUseProxy?: boolean;

  /**
   * API key for Xynapse Hub
   */
  apiKey?: string;

  /**
   * Base URL for the Xynapse API
   */
  baseURL?: string;
}

/**
 * Create and configure an OpenAI client that uses Xynapse Hub for authentication
 *
 * @param options - OpenAI client options with assistant models
 * @returns Configured OpenAI client
 */
export function createOpenAIClient({
  models: assistantModels,
  organizationId,
  apiKey,
  baseURL = "https://api.xynapse.dev/",
}: OpenAIClientOptions): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: new URL("model-proxy/v1/", baseURL).toString(),
    fetch: async (url, init) => {
      // Clone the init object to avoid modifying the original
      const modifiedInit = init ? { ...init } : {};

      if (init?.method === "POST" && init?.body) {
        try {
          const body = JSON.parse(init.body as string);

          const modelName = body.model;

          // Look up the model in the assistant's models
          const modelConfig = assistantModels?.find(
            (m) => m?.model === modelName || m?.model.endsWith(modelName),
          );

          if (!modelConfig) {
            throw new Error(
              `Model ${modelName} not found in assistant configuration`,
            );
          }

          if (
            !("apiKeyLocation" in modelConfig) &&
            !("envSecretLocations" in modelConfig)
          ) {
            throw new Error(
              `Model ${modelName} does not have an apiKeyLocation or envSecretLocations defined`,
            );
          }

          const continueProperties: XynapseProperties = {
            apiKeyLocation: modelConfig.apiKeyLocation,
            envSecretLocations: modelConfig.envSecretLocations,
            orgScopeId: organizationId ?? null,
          };

          // Update the request with the modified body
          modifiedInit.body = JSON.stringify({
            ...body,
            continueProperties,
          });
        } catch (e) {
          // If parsing fails, proceed with the original body
        }
      }

      // Using node-fetch explicitly, otherwise `fetch` has shadowing issues
      const response = await fetch(url.toString(), modifiedInit as any);

      return response as unknown as Response;
    },
  });
}
