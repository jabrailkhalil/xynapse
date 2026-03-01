import {
  ConfigResult,
  ConfigValidationError,
  FullSlug,
  Policy,
} from "@xynapse/config-yaml";

import {
  BrowserSerializedXynapseConfig,
  XynapseConfig,
  IContextProvider,
  IDE,
} from "../index.js";

import { Logger } from "../util/Logger.js";
import { finalToBrowserConfig } from "./load.js";
import { IProfileLoader } from "./profile/IProfileLoader.js";

export interface ProfileDescription {
  fullSlug: FullSlug;
  profileType: "control-plane" | "local" | "platform";
  title: string;
  id: string;
  iconUrl: string;
  errors: ConfigValidationError[] | undefined;
  uri: string;
  rawYaml?: string;
}

export interface OrganizationDescription {
  id: string;
  iconUrl: string;
  name: string;
  slug: string | undefined; // TODO: This doesn't need to be undefined, just doing while transitioning the backend
  policy?: Policy;
}

export type OrgWithProfiles = OrganizationDescription & {
  profiles: ProfileLifecycleManager[];
  currentProfile: ProfileLifecycleManager | null;
};

export type SerializedOrgWithProfiles = OrganizationDescription & {
  profiles: ProfileDescription[];
  selectedProfileId: string | null;
};

export class ProfileLifecycleManager {
  private savedConfigResult: ConfigResult<XynapseConfig> | undefined;
  private savedBrowserConfigResult?: ConfigResult<BrowserSerializedXynapseConfig>;
  private pendingConfigPromise?: Promise<ConfigResult<XynapseConfig>>;

  constructor(
    private readonly profileLoader: IProfileLoader,
    private readonly ide: IDE,
  ) {}

  get profileDescription(): ProfileDescription {
    return this.profileLoader.description;
  }

  clearConfig() {
    this.savedConfigResult = undefined;
    this.savedBrowserConfigResult = undefined;
    this.pendingConfigPromise = undefined;
  }

  // Clear saved config and reload
  async reloadConfig(
    additionalContextProviders: IContextProvider[] = [],
  ): Promise<ConfigResult<XynapseConfig>> {
    this.savedConfigResult = undefined;
    this.savedBrowserConfigResult = undefined;
    this.pendingConfigPromise = undefined;

    return this.loadConfig(additionalContextProviders, true);
  }

  async loadConfig(
    additionalContextProviders: IContextProvider[],
    forceReload: boolean = false,
  ): Promise<ConfigResult<XynapseConfig>> {
    // If we already have a config, return it
    if (!forceReload) {
      if (this.savedConfigResult) {
        return this.savedConfigResult;
      } else if (this.pendingConfigPromise) {
        return this.pendingConfigPromise;
      }
    }

    // Set pending config promise
    this.pendingConfigPromise = new Promise((resolve) => {
      void (async () => {
        let result: ConfigResult<XynapseConfig>;
        // This try catch is expected to catch high-level errors that aren't block-specific
        // Like invalid json, invalid yaml, file read errors, etc.
        // NOT block-specific loading errors
        try {
          result = await this.profileLoader.doLoadConfig();
        } catch (e) {
          // Capture config loading system failures to Sentry
          Logger.error(e, {
            context: "profile_config_loading",
          });

          const message =
            e instanceof Error
              ? `${e.message}\n${e.stack ? e.stack : ""}`
              : "Error loading config";
          result = {
            errors: [
              {
                fatal: true,
                message,
              },
            ],
            config: undefined,
            configLoadInterrupted: true,
          };
        }

        if (result.config) {
          // Add registered context providers
          result.config.contextProviders = (
            result.config.contextProviders ?? []
          ).concat(additionalContextProviders);
        }

        resolve(result);
      })();
    });

    // Wait for the config promise to resolve
    this.savedConfigResult = await this.pendingConfigPromise;
    this.pendingConfigPromise = undefined;
    return this.savedConfigResult;
  }

  async getSerializedConfig(
    additionalContextProviders: IContextProvider[],
  ): Promise<ConfigResult<BrowserSerializedXynapseConfig>> {
    if (this.savedBrowserConfigResult) {
      return this.savedBrowserConfigResult;
    } else {
      const result = await this.loadConfig(additionalContextProviders);
      if (!result.config) {
        return {
          ...result,
          config: undefined,
        };
      }
      const serializedConfig = await finalToBrowserConfig(
        result.config,
        this.ide,
      );
      return {
        ...result,
        config: serializedConfig,
      };
    }
  }
}
