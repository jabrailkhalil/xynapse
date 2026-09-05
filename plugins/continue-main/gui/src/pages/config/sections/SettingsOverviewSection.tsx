import {
  Cog6ToothIcon,
  CubeIcon,
  DocumentIcon,
  DocumentTextIcon,
  FolderPlusIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../../components/ui";
import { Divider } from "../../../components/ui/Divider";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { CONFIG_ROUTES } from "../../../util/navigation";
import { ConfigHeader } from "../components/ConfigHeader";
import { ConfigRow } from "../components/ConfigRow";

export function SettingsOverviewSection() {
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);

  const openCurrentConfig = () => {
    ideMessenger.post("config/openProfile", {
      profileId: undefined,
    });
  };

  const createConfig = async () => {
    await ideMessenger.request("config/newAssistantFile", undefined);
    navigate(CONFIG_ROUTES.CONFIGS);
  };

  return (
    <div className="space-y-6">
      <ConfigHeader
        title="Xynapse Settings"
        subtext="Configure the model, rules, tools, and local context used by the current Xynapse chat window."
      />

      <Card className="!p-0">
        <div className="flex flex-col">
          <ConfigRow
            title="Models"
            description="Select the chat model used by Chat, Plan, Edit, and Full runtime tasks."
            icon={CubeIcon}
            onClick={() => navigate(CONFIG_ROUTES.MODELS)}
          />
          <Divider className="!my-0" />
          <ConfigRow
            title="Rules"
            description="Manage rules injected into Xynapse Core runtime prompts."
            icon={DocumentTextIcon}
            onClick={() => navigate(CONFIG_ROUTES.RULES)}
          />
          <Divider className="!my-0" />
          <ConfigRow
            title="Tools"
            description="Enable or exclude tools passed to Plan, Edit, and Full runtime modes."
            icon={WrenchScrewdriverIcon}
            onClick={() => navigate(CONFIG_ROUTES.TOOLS)}
          />
          <Divider className="!my-0" />
          <ConfigRow
            title="Configs"
            description="Open or create local Xynapse profile files for this workspace."
            icon={DocumentIcon}
            onClick={() => navigate(CONFIG_ROUTES.CONFIGS)}
          />
        </div>
      </Card>

      <Card className="!p-0">
        <div className="flex flex-col">
          <ConfigRow
            title="Preferences"
            description="Adjust chat history tabs, markdown formatting, and local UI behavior."
            icon={Cog6ToothIcon}
            onClick={() => navigate(CONFIG_ROUTES.SETTINGS)}
          />
        </div>
      </Card>

      <Card className="!p-0">
        <div className="flex flex-col">
          <ConfigRow
            title="Open current config file"
            description="Edit the selected local Xynapse profile directly in the IDE."
            icon={DocumentIcon}
            onClick={openCurrentConfig}
          />
          <Divider className="!my-0" />
          <ConfigRow
            title="Create local config"
            description="Create another local Xynapse config profile and return to the Configs tab."
            icon={FolderPlusIcon}
            onClick={createConfig}
          />
        </div>
      </Card>
    </div>
  );
}
