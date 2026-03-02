import { OnboardingModes } from "core/protocol/core";
import { FormProvider, useForm } from "react-hook-form";
import { AddModelForm } from "../../../forms/AddModelForm";
import { providers } from "../../../pages/AddNewModel/configs/providers";
import { useAppDispatch } from "../../../redux/hooks";
import { setDialogMessage, setShowDialog } from "../../../redux/slices/uiSlice";
import { Button, Input } from "../../index";
import { useSubmitOnboarding } from "../hooks/useSubmitOnboarding";

interface OnboardingProvidersTabProps {
  /** Whether this is being shown in a dialog context */
  isDialog?: boolean;
}

export function OnboardingProvidersTab({
  isDialog,
}: OnboardingProvidersTabProps) {
  const formMethods = useForm();
  const dispatch = useAppDispatch();
  const { submitOnboarding } = useSubmitOnboarding(
    OnboardingModes.API_KEY,
    isDialog,
  );

  // Xynapse: show featured providers first, then others
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
    // Find the first provider with valid credentials entered
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
        <FormProvider {...formMethods}>
          <div className="mt-5 space-y-6">
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
                    placeholder={`Enter your ${config?.title} API key`}
                    className="w-full"
                    {...formMethods.register(`${config?.provider}_apiKey`)}
                  />
                  {isYandexProvider(config?.provider) && (
                    <div className="mt-2">
                      <Input
                        id={`${config?.provider}_folderId`}
                        type="text"
                        placeholder="Enter your Yandex Folder ID"
                        className="w-full"
                        {...formMethods.register(`${config?.provider}_folderId`)}
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
                      Click here
                    </a>{" "}
                    to create a {config?.title} API key
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
                Connect
              </Button>

              <div className="w-full text-center">
                <span className="text-description">
                  <span
                    className="cursor-pointer underline hover:brightness-125"
                    onClick={handleClickMoreProviders}
                  >
                    Click here
                  </span>{" "}
                  to view more providers
                </span>
              </div>
            </div>
          </div>
        </FormProvider>
      </div>
    </div>
  );
}
