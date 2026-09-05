import {
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  KeyIcon,
  ShieldCheckIcon,
  CloudIcon,
} from "@heroicons/react/24/outline";
import { OnboardingModes } from "core/protocol/core";
import { useContext, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { AddModelForm } from "../../../forms/AddModelForm";
import { providers } from "../../../pages/AddNewModel/configs/providers";
import { useAppDispatch } from "../../../redux/hooks";
import { setDialogMessage, setShowDialog } from "../../../redux/slices/uiSlice";
import { Button, Input, SecondaryButton } from "../../index";
import { useSubmitOnboarding } from "../hooks/useSubmitOnboarding";
import { useOnboardingCard } from "../hooks/useOnboardingCard";
import { YandexCloudForm } from "../../../forms/YandexCloudForm";

interface OnboardingProvidersTabProps {
  /** Whether this is being shown in a dialog context */
  isDialog?: boolean;
}

const onboardingTranslations: Record<string, Record<string, string>> = {
  ru: {
    "Port your Xynapse account": "Перенести аккаунт Xynapse",
    "Import your encrypted .enc profile to restore models, API keys, and account state on this device.":
      "Импортируйте зашифрованный .enc профиль, чтобы восстановить модели, API-ключи и состояние аккаунта на этом устройстве.",
    "Import encrypted profile": "Импортировать зашифрованный профиль",
    "Connect API keys manually": "Подключить API-ключи вручную",
    "Use this option for a new local profile or when you want to add provider keys one by one.":
      "Используйте этот вариант для нового локального профиля или если хотите добавить ключи провайдеров по одному.",
    "Without an imported Xynapse account, the profile stays locked and missing API keys are not activated.":
      "Без импортированного аккаунта Xynapse профиль остается закрытым, а отсутствующие API-ключи не активируются.",
    "Connection options": "Варианты подключения",
    "Enter your {provider} API key": "Введите API-ключ {provider}",
    "Enter your Yandex Folder ID": "Введите Yandex Folder ID",
    "Click here": "Нажмите здесь",
    "to create a {provider} API key": "чтобы создать API-ключ {provider}",
    Connect: "Подключить",
    "to view more providers": "чтобы посмотреть других провайдеров",
  },
  ja: {
    "Port your Xynapse account": "Xynapse アカウントを移行",
    "Import your encrypted .enc profile to restore models, API keys, and account state on this device.":
      "暗号化された .enc プロファイルをインポートして、このデバイスでモデル、API キー、アカウント状態を復元します。",
    "Import encrypted profile": "暗号化プロファイルをインポート",
    "Connect API keys manually": "API キーを手動で接続",
    "Use this option for a new local profile or when you want to add provider keys one by one.":
      "新しいローカルプロファイルを作成する場合、またはプロバイダーのキーを 1 つずつ追加する場合に使用します。",
    "Without an imported Xynapse account, the profile stays locked and missing API keys are not activated.":
      "Xynapse アカウントをインポートしない場合、プロファイルはロックされたままで、不足している API キーは有効化されません。",
    "Connection options": "接続オプション",
    "Enter your {provider} API key": "{provider} の API キーを入力",
    "Enter your Yandex Folder ID": "Yandex Folder ID を入力",
    "Click here": "ここをクリック",
    "to create a {provider} API key": "{provider} の API キーを作成",
    Connect: "接続",
    "to view more providers": "他のプロバイダーを表示",
  },
};

function getXynapseLocale(): string {
  return "en";
}

function t(key: string, params: Record<string, string> = {}): string {
  const locale = getXynapseLocale();
  let value = onboardingTranslations[locale]?.[key] ?? key;
  for (const [name, replacement] of Object.entries(params)) {
    value = value.split(`{${name}}`).join(replacement);
  }
  return value;
}

export function OnboardingProvidersTab({
  isDialog,
}: OnboardingProvidersTabProps) {
  const formMethods = useForm();
  const ideMessenger = useContext(IdeMessengerContext);
  const [setupMode, setSetupMode] = useState<"choice" | "manual" | "yandex">(
    "choice",
  );
  const { close: closeOnboarding } = useOnboardingCard();
  const dispatch = useAppDispatch();
  const { submitOnboarding } = useSubmitOnboarding(
    OnboardingModes.API_KEY,
    isDialog,
  );

  // Xynapse: show featured providers first, then others.
  const providerConfigs = [
    providers["yandex_gpt"],
    providers["gigachat"],
    providers["openai"],
    providers["anthropic"],
    providers["gemini"],
  ];

  const isYandexProvider = (provider?: string) =>
    provider === "yandex_gpt" || provider === "yandexgpt";

  const handleFormSubmit = () => {
    // Find the first provider with valid credentials entered.
    for (const config of providerConfigs) {
      const provider = config?.provider;
      if (!provider) {
        continue;
      }

      const apiKey = formMethods.watch(`${provider}_apiKey`)?.trim();
      if (!apiKey) {
        continue;
      }

      const requiresFolderId = isYandexProvider(provider);
      const folderId = formMethods.watch(`${provider}_folderId`)?.trim();

      if (requiresFolderId && !folderId) {
        continue;
      }

      submitOnboarding(provider, apiKey, folderId);
      return;
    }
  };

  const handleClickMoreProviders = () => {
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        <AddModelForm
          onDone={() => {
            dispatch(setShowDialog(false));
            submitOnboarding();
          }}
        />,
      ),
    );
  };

  const handleImportProfile = () => {
    ideMessenger.post("xynapse/importProfile", undefined);
  };

  const hasAnyValidCredentials = providerConfigs.some((config) => {
    const provider = config?.provider;
    if (!provider) {
      return false;
    }

    const apiKey = formMethods.watch(`${provider}_apiKey`)?.trim();
    if (!apiKey) {
      return false;
    }

    if (!isYandexProvider(provider)) {
      return true;
    }

    const folderId = formMethods.watch(`${provider}_folderId`)?.trim();
    return Boolean(folderId);
  });

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="w-full max-w-md">
        {setupMode === "choice" && (
          <div className="mt-5 space-y-4">
            <button
              type="button"
              onClick={() => setSetupMode("yandex")}
              className="border-border text-foreground hover:bg-input/60 flex w-full cursor-pointer items-start gap-3 rounded-lg border border-solid bg-transparent p-3 text-left"
            >
              <CloudIcon className="h-6 w-6 flex-shrink-0" />
              <div>
                <div className="text-base font-semibold">Yandex Cloud</div>
                <div className="text-description mt-1 text-sm leading-5">
                  Connect one API key and import all available chat models.
                </div>
              </div>
            </button>
            <div className="border-border bg-input/40 rounded-lg border border-solid p-3">
              <div className="flex items-start gap-3">
                <div className="bg-foreground/10 rounded-lg p-2">
                  <ShieldCheckIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-base font-semibold">
                    {t("Restore profile")}
                  </div>
                  <div className="text-description mt-1 text-sm leading-5">
                    {t(
                      "Import a .xynapse folder, config.yaml/json, account.json, profile.json, environment.env, or an old .enc backup.",
                    )}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                onClick={handleImportProfile}
                className="mt-4 flex w-full items-center justify-center gap-2"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {t("Import profile/config")}
              </Button>
            </div>

            <button
              type="button"
              onClick={() => setSetupMode("manual")}
              className="border-border text-foreground hover:bg-input/60 flex w-full cursor-pointer items-start gap-3 rounded-lg border border-solid bg-transparent p-3 text-left transition-colors"
            >
              <div className="bg-foreground/10 rounded-lg p-2">
                <KeyIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-semibold">
                  {t("Configure manually")}
                </div>
                <div className="text-description mt-1 text-sm leading-5">
                  {t("Add provider keys in this IDE.")}
                </div>
              </div>
            </button>

            <div className="text-description-muted text-xs leading-5">
              {t(
                "You can import a profile/config now or configure keys manually.",
              )}
            </div>
          </div>
        )}

        {setupMode === "yandex" && (
          <div className="mt-5 space-y-5">
            <SecondaryButton
              type="button"
              onClick={() => setSetupMode("choice")}
              className="!m-0 inline-flex items-center gap-1"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Connection options
            </SecondaryButton>
            <YandexCloudForm onDone={() => closeOnboarding(isDialog)} />
          </div>
        )}
        {setupMode === "manual" && (
          <FormProvider {...formMethods}>
            <div className="mt-5 space-y-6">
              <SecondaryButton
                type="button"
                onClick={() => setSetupMode("choice")}
                className="!m-0 inline-flex items-center gap-1"
              >
                <ChevronLeftIcon className="h-4 w-4" />
                {t("Connection options")}
              </SecondaryButton>
              <div className="space-y-4">
                {providerConfigs.map((config) => (
                  <div key={config?.provider}>
                    <label className="mb-1 flex items-center gap-3 text-sm font-medium">
                      {window.vscMediaUrl && (
                        <img
                          src={`${window.vscMediaUrl}/logos/${config?.icon}`}
                          alt={config?.provider}
                          className="h-4 w-4 object-contain"
                        />
                      )}
                      {config?.title}
                    </label>
                    <Input
                      id={`${config?.provider}_apiKey`}
                      type="password"
                      placeholder={t("Enter your {provider} API key", {
                        provider: config?.title ?? "",
                      })}
                      className="w-full"
                      {...formMethods.register(`${config?.provider}_apiKey`)}
                    />
                    {isYandexProvider(config?.provider) && (
                      <div className="mt-2">
                        <Input
                          id={`${config?.provider}_folderId`}
                          type="text"
                          placeholder={t("Enter your Yandex Folder ID")}
                          className="w-full"
                          {...formMethods.register(
                            `${config?.provider}_folderId`,
                          )}
                        />
                      </div>
                    )}
                    <span className="text-description-muted mt-1 block text-xs">
                      <a
                        href={config?.apiKeyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cursor-pointer text-inherit underline hover:text-inherit hover:brightness-125"
                      >
                        {t("Click here")}
                      </a>{" "}
                      {t("to create a {provider} API key", {
                        provider: config?.title ?? "",
                      })}
                    </span>
                  </div>
                ))}
              </div>

              <div>
                <Button
                  type="button"
                  onClick={handleFormSubmit}
                  disabled={!hasAnyValidCredentials}
                  className="w-full"
                >
                  {t("Connect")}
                </Button>

                <div className="w-full text-center">
                  <span className="text-description">
                    <span
                      className="cursor-pointer underline hover:brightness-125"
                      onClick={handleClickMoreProviders}
                    >
                      {t("Click here")}
                    </span>{" "}
                    {t("to view more providers")}
                  </span>
                </div>
              </div>
            </div>
          </FormProvider>
        )}
      </div>
    </div>
  );
}
