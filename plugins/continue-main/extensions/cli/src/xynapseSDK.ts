import { Xynapse, XynapseClient } from "@xynapse/sdk";
import chalk from "chalk";

import { env } from "./env.js";

/**
 * Initialize the Xynapse SDK with the given parameters
 * @param apiKey - API key to use for authentication
 * @param assistantSlug - Slug of the assistant to use
 * @param organizationId - Optional organization ID
 * @returns Promise resolving to the Xynapse SDK instance
 */
export async function initializeXynapseSDK(
  apiKey: string | undefined,
  assistantSlug: string,
  organizationId?: string,
): Promise<XynapseClient> {
  if (!apiKey) {
    console.error(chalk.red("Error: No API key provided for Xynapse SDK"));
    throw new Error("No API key provided for Xynapse SDK");
  }

  try {
    return await Xynapse.from({
      apiKey,
      assistant: assistantSlug,
      organizationId,
      baseURL: env.apiBase,
    });
  } catch (error) {
    console.error(
      chalk.red("Error initializing Xynapse SDK:"),
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
