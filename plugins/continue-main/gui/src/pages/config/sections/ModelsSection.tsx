import { ModelRole } from "@xynapse/config-yaml";
import { ModelDescription } from "core";
import { useContext, useState } from "react";
import Shortcut from "../../../components/gui/Shortcut";
import { useEditModel } from "../../../components/mainInput/Lump/useEditBlock";
import { Card, Divider, Toggle } from "../../../components/ui";
import { useAuth } from "../../../context/Auth";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { AddModelForm } from "../../../forms/AddModelForm";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { setDialogMessage, setShowDialog } from "../../../redux/slices/uiSlice";
import { updateSelectedModelByRole } from "../../../redux/thunks/updateSelectedModelByRole";
import { getMetaKeyLabel, isJetBrains } from "../../../util";
import { ConfigHeader } from "../components/ConfigHeader";
import { ModelRoleRow } from "../components/ModelRoleRow";

export function ModelsSection() {
  const { selectedProfile } = useAuth();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  const config = useAppSelector((state) => state.config.config);
  const jetbrains = isJetBrains();
  const metaKey = getMetaKeyLabel();
  const [showAdditionalRoles, setShowAdditionalRoles] = useState(false);

  function handleRoleUpdate(role: ModelRole, model: ModelDescription | null) {
    if (!model) {
      return;
    }

    void dispatch(
      updateSelectedModelByRole({
        role,
        selectedProfile,
        modelTitle: model.title,
      }),
    );
  }

  const handleConfigureModel = useEditModel();

  function handleAddModel() {
    const isLocal = selectedProfile?.profileType === "local";

    if (isLocal) {
      dispatch(setShowDialog(true));
      dispatch(
        setDialogMessage(
          <AddModelForm
            onDone={() => {
              dispatch(setShowDialog(false));
            }}
          />,
        ),
      );
    } else {
      void ideMessenger.request("controlPlane/openUrl", {
        path: "?type=models",
        orgSlug: undefined,
      });
    }
  }

  return (
    <div className="space-y-4">
      <ConfigHeader
        title="Модели"
        onAddClick={handleAddModel}
        addButtonTooltip="Добавить модель"
      />

      <Card>
        <ModelRoleRow
          role="chat"
          displayName="Чат"
          shortcut={
            <span className="text-2xs text-description-muted">
              (<Shortcut>{`cmd ${jetbrains ? "J" : "L"}`}</Shortcut>)
            </span>
          }
          description={
            <span>
              Используется в режимах Чат, План, Агент
            </span>
          }
          models={config.modelsByRole.chat}
          selectedModel={config.selectedModelByRole.chat ?? undefined}
          onSelect={(model) => handleRoleUpdate("chat", model)}
          onConfigure={handleConfigureModel}
          setupURL="https://docs.xynapse.dev/chat/model-setup"
        />

        <Divider />

        <ModelRoleRow
          role="autocomplete"
          displayName="Автодополнение"
          description={
            <span>
              Используется для подсказок кода при вводе
            </span>
          }
          models={config.modelsByRole.autocomplete}
          selectedModel={config.selectedModelByRole.autocomplete ?? undefined}
          onSelect={(model) => handleRoleUpdate("autocomplete", model)}
          onConfigure={handleConfigureModel}
          setupURL="https://docs.xynapse.dev/autocomplete/model-setup"
        />

        {/* Jetbrains has a model selector inline */}
        {!jetbrains && (
          <>
            <Divider />
            <ModelRoleRow
              role="edit"
              displayName="Редактирование"
              shortcut={
                <span className="text-2xs text-description-muted">
                  (<Shortcut>cmd I</Shortcut>)
                </span>
              }
              description={
                <span>
                  Используется для трансформации выделенного кода
                </span>
              }
              models={config.modelsByRole.edit}
              selectedModel={config.selectedModelByRole.edit ?? undefined}
              onSelect={(model) => handleRoleUpdate("edit", model)}
              onConfigure={handleConfigureModel}
              setupURL="https://docs.xynapse.dev/edit/model-setup"
            />
          </>
        )}
      </Card>

      <Card>
        <Toggle
          isOpen={showAdditionalRoles}
          onToggle={() => setShowAdditionalRoles(!showAdditionalRoles)}
          title="Дополнительные роли"
          subtitle="Применение, Эмбеддинги, Ранжирование"
        >
          <div className="flex flex-col">
            <ModelRoleRow
              role="apply"
              displayName="Применение"
              description="Используется для применения сгенерированных блоков кода к файлам"
              models={config.modelsByRole.apply}
              selectedModel={config.selectedModelByRole.apply ?? undefined}
              onSelect={(model) => handleRoleUpdate("apply", model)}
              onConfigure={handleConfigureModel}
              setupURL="https://docs.xynapse.dev/customize/model-roles/apply"
            />

            <Divider />

            <ModelRoleRow
              role="embed"
              displayName="Эмбеддинги"
              description="Используется для создания и поиска эмбеддингов (@codebase и @docs)"
              models={config.modelsByRole.embed}
              selectedModel={config.selectedModelByRole.embed ?? undefined}
              onSelect={(model) => handleRoleUpdate("embed", model)}
              onConfigure={handleConfigureModel}
              setupURL="https://docs.xynapse.dev/customize/model-roles/embeddings"
            />

            <Divider />

            <ModelRoleRow
              role="rerank"
              displayName="Ранжирование"
              description="Используется для ранжирования результатов (@codebase и @docs)"
              models={config.modelsByRole.rerank}
              selectedModel={config.selectedModelByRole.rerank ?? undefined}
              onSelect={(model) => handleRoleUpdate("rerank", model)}
              onConfigure={handleConfigureModel}
              setupURL="https://docs.xynapse.dev/customize/model-roles/reranking"
            />
          </div>
        </Toggle>
      </Card>
    </div>
  );
}
