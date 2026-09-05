import os from "node:os";

import {
  ControlPlaneProxyInfo,
  IAnalyticsProvider,
} from "./analytics/IAnalyticsProvider.js";
import { ControlPlaneClient } from "./client.js";
import { AnalyticsConfig } from "../index.js";

function createAnalyticsProvider(
  _config: AnalyticsConfig,
): IAnalyticsProvider | undefined {
  return undefined;
}

export class TeamAnalytics {
  static provider: IAnalyticsProvider | undefined = undefined;
  static uniqueId = "NOT_UNIQUE";
  static os: string | undefined = undefined;
  static extensionVersion: string | undefined = undefined;

  static async capture(event: string, properties: { [key: string]: any }) {
    void TeamAnalytics.provider?.capture(event, {
      ...properties,
      os: TeamAnalytics.os,
      extensionVersion: TeamAnalytics.extensionVersion,
    });
  }

  static async setup(
    config: AnalyticsConfig,
    uniqueId: string,
    extensionVersion: string,
    controlPlaneClient: ControlPlaneClient,
    controlPlaneProxyInfo: ControlPlaneProxyInfo,
  ) {
    TeamAnalytics.uniqueId = uniqueId;
    TeamAnalytics.os = os.platform();
    TeamAnalytics.extensionVersion = extensionVersion;
    TeamAnalytics.provider = createAnalyticsProvider(config);
    await TeamAnalytics.provider?.setup(
      config,
      uniqueId,
      controlPlaneProxyInfo,
    );
  }

  static async shutdown() {
    if (TeamAnalytics.provider) {
      await TeamAnalytics.provider.shutdown();
      TeamAnalytics.provider = undefined;
      TeamAnalytics.os = undefined;
      TeamAnalytics.extensionVersion = undefined;
      TeamAnalytics.uniqueId = "NOT_UNIQUE";
    }
  }
}
