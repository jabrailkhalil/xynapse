// ProfileHandlers manage the loading of a config, allowing us to abstract over different ways of getting to a XynapseConfig

import { ConfigResult } from "@xynapse/config-yaml";
import { XynapseConfig } from "../../index.js";
import { ProfileDescription } from "../ProfileLifecycleManager.js";

// After we have the XynapseConfig, the ConfigHandler takes care of everything else (loading models, lifecycle, etc.)
export interface IProfileLoader {
  description: ProfileDescription;
  doLoadConfig(): Promise<ConfigResult<XynapseConfig>>;
  setIsActive(isActive: boolean): void;
}
