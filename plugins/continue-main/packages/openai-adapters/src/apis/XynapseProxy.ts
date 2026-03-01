import { OpenAI } from "openai/index";
import {
  ChatCompletionCreateParams,
  CompletionCreateParamsNonStreaming,
  CompletionCreateParamsStreaming,
} from "openai/resources/index";
import { z } from "zod";
import { XynapseProxyConfigSchema } from "../types.js";
import { FimCreateParamsStreaming, RerankCreateParams } from "./base.js";
import { OpenAIApi } from "./OpenAI.js";

export interface XynapseProperties {
  apiKeyLocation?: string;
  envSecretLocations?: Record<string, string>;
  apiBase?: string;
  orgScopeId?: string | null;
  env?: Record<string, any>;
}

export interface ProxyModelName {
  ownerSlug: string;
  packageSlug: string;
  provider: string;
  model: string;
}

export class XynapseProxyApi extends OpenAIApi {
  // The apiKey and apiBase are set to the values for the proxy,
  // but we need to keep track of the actual values that the proxy will use
  // to call whatever LLM API is chosen
  private actualApiBase?: string;

  // Contains extra properties that we pass along to the proxy. Originally from `env` property on LLMOptions
  private configEnv?: Record<string, any>;

  // Store the Xynapse proxy config separately
  private continueProxyConfig: z.infer<typeof XynapseProxyConfigSchema>;

  constructor(config: z.infer<typeof XynapseProxyConfigSchema>) {
    // Convert XynapseProxyConfigSchema to OpenAIConfigSchema format
    const openaiConfig = {
      provider: "openai" as const,
      apiKey: config.apiKey,
      apiBase: config.env?.proxyUrl
        ? new URL("model-proxy/v1/", config.env?.proxyUrl).toString()
        : "https://api.xynapse.dev/model-proxy/v1/",
      requestOptions: config.requestOptions,
    };

    super(openaiConfig);

    this.xynapseProxyConfig = config;
    this.configEnv = config.env;
    this.actualApiBase = config.apiBase;
  }

  protected extraBodyProperties(): Record<string, any> {
    const continueProperties: XynapseProperties = {
      apiKeyLocation: this.xynapseProxyConfig.env?.apiKeyLocation,
      envSecretLocations: this.xynapseProxyConfig.env?.envSecretLocations,
      apiBase: this.actualApiBase,
      orgScopeId: this.xynapseProxyConfig.env?.orgScopeId ?? null,
      env: this.configEnv,
    };
    return {
      continueProperties,
    };
  }

  private modifyBodyWithXynapseProperties<T extends Record<string, any>>(
    body: T,
  ): T {
    return {
      ...body,
      ...this.extraBodyProperties(),
    };
  }

  modifyChatBody<T extends ChatCompletionCreateParams>(body: T): T {
    // First apply OpenAI-specific modifications
    const modifiedBody = super.modifyChatBody(body);
    // Then add Xynapse properties
    return this.modifyBodyWithXynapseProperties(modifiedBody);
  }

  modifyCompletionBody<
    T extends
      | CompletionCreateParamsNonStreaming
      | CompletionCreateParamsStreaming,
  >(body: T): T {
    return this.modifyBodyWithXynapseProperties(body);
  }

  modifyFimBody<T extends FimCreateParamsStreaming>(body: T): T {
    const modifiedBody = super.modifyFimBody(body);
    return this.modifyBodyWithXynapseProperties(modifiedBody);
  }

  protected getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": this.xynapseProxyConfig.apiKey ?? "",
      Authorization: `Bearer ${this.xynapseProxyConfig.apiKey}`,
    };
  }

  modifyEmbedBody<T extends OpenAI.Embeddings.EmbeddingCreateParams>(
    body: T,
  ): T {
    return this.modifyBodyWithXynapseProperties(body);
  }

  modifyRerankBody<T extends RerankCreateParams>(body: T): T {
    return {
      ...body,
      ...this.extraBodyProperties(),
    };
  }
}
