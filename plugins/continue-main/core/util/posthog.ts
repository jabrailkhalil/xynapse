import os from "node:os";

import { IdeInfo } from "../index.js";

import { TokensBatchingService } from "./TokensBatchingService.js";

export enum PosthogFeatureFlag {
  AutocompleteTimeout = "autocomplete-timeout",
  RecentlyVisitedRangesNumSurroundingLines = "recently-visited-ranges-num-surrounding-lines",
}

export const EXPERIMENTS: {
  [key in PosthogFeatureFlag]: {
    [key: string]: { value: any };
  };
} = {
  [PosthogFeatureFlag.AutocompleteTimeout]: {
    control: { value: 150 },
    "250": { value: 250 },
    "350": { value: 350 },
    "450": { value: 450 },
  },
  [PosthogFeatureFlag.RecentlyVisitedRangesNumSurroundingLines]: {
    control: { value: null },
    "5": { value: 5 },
    "10": { value: 10 },
    "15": { value: 15 },
    "20": { value: 20 },
  },
};

export class Telemetry {
  // Set to undefined whenever telemetry is disabled
  static client: undefined = undefined;
  static uniqueId = "NOT_UNIQUE";
  static os: string | undefined = undefined;
  static ideInfo: IdeInfo | undefined = undefined;

  /**
   * Convenience method for capturing errors in a single event
   */
  static async captureError(_errorName: string, _error: unknown) {
    return;
  }

  static async capture(
    _event: string,
    _properties: { [key: string]: any },
    _sendToTeam: boolean = false,
    _isExtensionActivationError: boolean = false,
  ) {
    return;
  }

  static shutdownPosthogClient() {
    TokensBatchingService.getInstance().shutdown();
  }

  static async getTelemetryClient(): Promise<undefined> {
    return void 0;
  }

  static async setup(_allow: boolean, uniqueId: string, ideInfo: IdeInfo) {
    Telemetry.uniqueId = uniqueId;
    Telemetry.os = os.platform();
    Telemetry.ideInfo = ideInfo;
    Telemetry.client = void 0;
  }

  private static featureValueCache: Record<string, any> = {};

  static async getFeatureFlag(_flag: PosthogFeatureFlag) {
    return void 0;
  }

  static async getValueForFeatureFlag(_flag: PosthogFeatureFlag) {
    try {
      return void 0;
    } catch {
      return undefined;
    }
  }
}
