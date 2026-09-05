import { createAsyncThunk } from "@reduxjs/toolkit";
import posthog from "posthog-js";
import StreamErrorDialog from "../../pages/gui/StreamError";
import { analyzeError } from "../../util/errorAnalysis";
import { selectSelectedChatModel } from "../slices/configSlice";
import { setDialogMessage, setShowDialog } from "../slices/uiSlice";
import { ThunkApiType } from "../store";
import { cancelStream } from "./cancelStream";
import { saveCurrentSession } from "./session";

export const streamThunkWrapper = createAsyncThunk<
  void,
  () => Promise<void>,
  ThunkApiType
>("chat/streamWrapper", async (runStream, { dispatch, extra, getState }) => {
  try {
    await runStream();
    const state = getState();
    if (!state.session.isInEdit) {
      await dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: true,
        }),
      );
    }
  } catch (e) {
    await dispatch(cancelStream());
    const state = getState();
    if (!state.session.isInEdit && state.session.history.length > 0) {
      await dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: false,
        }),
      );
    }
    dispatch(setDialogMessage(<StreamErrorDialog error={e} />));
    dispatch(setShowDialog(true));

    // Get the selected model from the state for error analysis
    const selectedModel = selectSelectedChatModel(state);

    const { parsedError, statusCode, modelTitle, providerName } = analyzeError(
      e,
      selectedModel,
    );

    const errorData = {
      error_type: statusCode ? `HTTP ${statusCode}` : "Unknown",
      error_message: parsedError,
      model_provider: providerName,
      model_title: modelTitle,
    };

    posthog.capture("gui_stream_error", errorData);
  }
});
