import { ModelRole } from "@xynapse/config-yaml";
import { createAsyncThunk } from "@reduxjs/toolkit";
import { ProfileDescription } from "core/config/ProfileLifecycleManager";
import { updateConfig } from "../slices/configSlice";
import { ThunkApiType } from "../store";

function modelOptionValue(model: any): string {
  const candidates = [model?.title, model?.model, model?.class_name];
  return (
    candidates.find(
      (candidate) =>
        typeof candidate === "string" && candidate.trim().length > 0,
    ) ?? ""
  );
}

export const updateSelectedModelByRole = createAsyncThunk<
  void,
  {
    role: ModelRole;
    modelTitle: string;
    selectedProfile: ProfileDescription | null;
  },
  ThunkApiType
>(
  "config/updateSelectedModel",
  async (
    { role, modelTitle, selectedProfile },
    { dispatch, extra, getState },
  ) => {
    if (!selectedProfile) {
      return;
    }

    const state = getState();

    const {
      config: { config },
    } = state;

    const model = state.config.config.modelsByRole[role]?.find(
      (m) => modelOptionValue(m) === modelTitle,
    );

    if (!model) {
      console.error(
        `Model with title "${modelTitle}" not found for role "${role}"`,
      );
      return;
    }

    const resolvedModelTitle = modelOptionValue(model) || modelTitle;

    dispatch(
      updateConfig({
        ...config,
        selectedModelByRole: {
          ...config.selectedModelByRole,
          [role]: model,
        },
      }),
    );

    extra.ideMessenger.post("config/updateSelectedModel", {
      role,
      profileId: selectedProfile.id,
      title: resolvedModelTitle,
    });
  },
);
