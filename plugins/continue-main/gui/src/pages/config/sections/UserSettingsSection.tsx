import {
  SharedConfigSchema,
  modifyAnyConfigWithSharedConfig,
} from "core/config/sharedConfig";
import { useContext } from "react";
import { Card } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { updateConfig } from "../../../redux/slices/configSlice";
import { ConfigHeader } from "../components/ConfigHeader";
import { UserSetting } from "../components/UserSetting";

export function UserSettingsSection() {
  /////// User settings section //////
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const config = useAppSelector((state) => state.config.config);

  function handleUpdate(sharedConfig: SharedConfigSchema) {
    // Optimistic update
    const updatedConfig = modifyAnyConfigWithSharedConfig(config, sharedConfig);
    dispatch(updateConfig(updatedConfig));
    // IMPORTANT no need for model role updates (separate logic for selected model roles)
    // simply because this function won't be used to update model roles

    // Actual update to core which propagates back with config update event
    ideMessenger.post("config/updateSharedConfig", sharedConfig);
  }

  // TODO defaults are in multiple places, should be consolidated and probably not explicit here
  const showSessionTabs = config.ui?.showSessionTabs ?? false;
  const codeWrap = config.ui?.codeWrap ?? false;
  const showChatScrollbar = config.ui?.showChatScrollbar ?? false;
  const displayRawMarkdown = config.ui?.displayRawMarkdown ?? false;
  const disableSessionTitles = config.disableSessionTitles ?? false;

  return (
    <div>
      <div className="flex flex-col">
        <ConfigHeader title="Preferences" />
        <div className="space-y-6">
          {/* Chat Interface Settings */}
          <div>
            <ConfigHeader
              title="Chat window"
              variant="sm"
              subtext="These preferences affect the visible Xynapse chat history. Model, rule, and tool behavior lives in the dedicated tabs."
            />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="toggle"
                  title="Show Session Tabs"
                  description="Displays tabs above the chat as an alternative way to organize and access your sessions."
                  value={showSessionTabs}
                  onChange={(value) => handleUpdate({ showSessionTabs: value })}
                />
                <UserSetting
                  type="toggle"
                  title="Wrap Codeblocks"
                  description="Wraps long lines in code blocks instead of showing horizontal scroll."
                  value={codeWrap}
                  onChange={(value) => handleUpdate({ codeWrap: value })}
                />
                <UserSetting
                  type="toggle"
                  title="Show Chat Scrollbar"
                  description="Enables a scrollbar in the chat window."
                  value={showChatScrollbar}
                  onChange={(value) =>
                    handleUpdate({ showChatScrollbar: value })
                  }
                />
                <UserSetting
                  type="toggle"
                  title="Enable Session Titles"
                  description="Generates summary titles for each chat session after the first message, using the current Chat model."
                  value={!disableSessionTitles}
                  onChange={(value) =>
                    handleUpdate({ disableSessionTitles: !value })
                  }
                />
                <UserSetting
                  type="toggle"
                  title="Format Markdown"
                  description="If off, shows responses as raw text."
                  value={!displayRawMarkdown}
                  onChange={(value) =>
                    handleUpdate({ displayRawMarkdown: !value })
                  }
                />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
