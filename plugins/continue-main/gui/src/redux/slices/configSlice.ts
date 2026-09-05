import { ConfigResult, ConfigValidationError } from "@xynapse/config-yaml";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { BrowserSerializedXynapseConfig } from "core";
import { DEFAULT_MAX_TOKENS } from "core/llm/constants";

export type ConfigState = {
  configError: ConfigValidationError[] | undefined;
  config: BrowserSerializedXynapseConfig;
  loading: boolean;
};

export const EMPTY_CONFIG: BrowserSerializedXynapseConfig = {
  slashCommands: [],
  contextProviders: [],
  tools: [],
  mcpServerStatuses: [],
  usePlatform: true,
  modelsByRole: {
    chat: [],
    apply: [],
    edit: [],
    summarize: [],
    autocomplete: [],
    rerank: [],
    embed: [],
  },
  selectedModelByRole: {
    chat: null,
    apply: null,
    edit: null,
    summarize: null,
    autocomplete: null,
    rerank: null,
    embed: null,
  },
  rules: [],
};

export const INITIAL_CONFIG_SLICE: ConfigState = {
  configError: undefined,
  config: EMPTY_CONFIG,
  loading: false,
};

export const configSlice = createSlice({
  name: "config",
  initialState: INITIAL_CONFIG_SLICE,
  reducers: {
    setConfigResult: (
      state,
      {
        payload: result,
      }: PayloadAction<ConfigResult<BrowserSerializedXynapseConfig>>,
    ) => {
      const { config, errors } = result;
      if (!errors || errors.length === 0) {
        state.configError = undefined;
      } else {
        state.configError = errors;
      }

      // If config is undefined (e.g. configLoadInterrupted), keep the
      // previously loaded config rather than replacing with empty.
      // Only fall back to EMPTY_CONFIG if there was no prior config.
      if (!config) {
        const hasPriorConfig =
          state.config && state.config.modelsByRole?.chat?.length > 0;
        if (!hasPriorConfig) {
          state.config = EMPTY_CONFIG;
        }
      } else {
        state.config = config;
      }
      state.loading = false;
    },
    updateConfig: (
      state,
      { payload: config }: PayloadAction<BrowserSerializedXynapseConfig>,
    ) => {
      state.config = config;
    },
    setConfigLoading: (state, { payload: loading }: PayloadAction<boolean>) => {
      state.loading = loading;
    },
  },
  selectors: {
    selectSelectedChatModelContextLength: (state): number => {
      return (
        state.config.selectedModelByRole.chat?.contextLength ||
        DEFAULT_MAX_TOKENS
      );
    },
    selectSelectedChatModel: (state) => {
      return state.config.selectedModelByRole.chat;
    },
    selectUIConfig: (state) => {
      return state.config?.ui ?? null;
    },
  },
});

export const { updateConfig, setConfigResult, setConfigLoading } =
  configSlice.actions;

export const {
  selectSelectedChatModelContextLength,
  selectUIConfig,
  selectSelectedChatModel,
} = configSlice.selectors;

export default configSlice.reducer;
