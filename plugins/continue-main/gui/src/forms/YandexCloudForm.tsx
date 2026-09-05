import { ArrowPathIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import type { YandexCloudImportResult } from "core/config/yandexCloud";
import { FormEvent, useContext, useRef, useState } from "react";
import { Button, Input, SecondaryButton } from "../components";
import { ModelIcon } from "../components/modelSelection/ModelIcon";
import { IdeMessengerContext } from "../context/IdeMessenger";

export function YandexCloudForm({ onDone }: { onDone?: () => void }) {
  const ideMessenger = useContext(IdeMessengerContext);
  const [apiKey, setApiKey] = useState("");
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [result, setResult] = useState<YandexCloudImportResult>();

  async function importModels(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setResult(undefined);
    try {
      const response = await ideMessenger.request("config/importYandexCloud", {
        apiKey: apiKey.trim(),
        folderId: folderId.trim(),
      });
      const imported =
        response.status === "success" ? response.content : undefined;
      setResult(
        imported ?? {
          ok: false,
          message:
            "Could not import models. Check your connection and try again.",
        },
      );
      if (imported?.ok) setApiKey("");
    } catch {
      setResult({
        ok: false,
        message:
          "Could not import models. Check your connection and try again.",
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={importModels}
      className="mx-auto w-full max-w-md space-y-5"
      aria-label="Connect Yandex Cloud"
      aria-busy={busy}
    >
      <div>
        <div className="flex items-center gap-2">
          <img
            src={`${window.vscMediaUrl ?? ""}/logos/yandex-cloud.png`}
            alt=""
            className="h-6 w-6 object-contain"
          />
          <h2 className="m-0 text-xl">Yandex Cloud</h2>
        </div>
        <p className="text-description text-sm leading-5">
          One API key connects all available chat models in your folder,
          including YandexGPT, Alice, DeepSeek, Qwen, and GPT-OSS.
        </p>
      </div>
      <div>
        <label
          htmlFor="yandex-cloud-api-key"
          className="mb-1 block text-sm font-medium"
        >
          API key
        </label>
        <Input
          id="yandex-cloud-api-key"
          name="yandex-cloud-api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required={!result?.ok}
          disabled={busy}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Paste your Yandex Cloud API key"
          className="w-full"
        />
      </div>
      <div>
        <label
          htmlFor="yandex-cloud-folder-id"
          className="mb-1 block text-sm font-medium"
        >
          Folder ID
        </label>
        <Input
          id="yandex-cloud-folder-id"
          name="yandex-cloud-folder-id"
          autoComplete="off"
          spellCheck={false}
          required={!result?.ok}
          disabled={busy}
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
          placeholder="Enter the folder ID"
          className="w-full"
        />
        <p className="text-description-muted mt-1 text-xs">
          Copy it from the folder menu in Yandex Cloud.
        </p>
      </div>
      <Button
        type="submit"
        disabled={busy || !apiKey.trim() || !folderId.trim()}
        className="flex w-full items-center justify-center gap-2"
      >
        {busy && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
        {busy ? "Connecting and importing…" : "Connect and import all models"}
      </Button>
      <p className="text-description-muted text-xs leading-5">
        Credentials are saved in your local Xynapse profile. Reconnecting
        updates existing models without adding duplicates.
      </p>
      <SecondaryButton
        type="button"
        onClick={() =>
          ideMessenger.post(
            "openUrl",
            "https://aistudio.yandex.ru/en/docs/ai-studio/operations/models/get",
          )
        }
        className="!m-0"
      >
        Get a key and Folder ID
      </SecondaryButton>
      {result &&
        (result.ok ? (
          <div
            role="status"
            className="border-border rounded-lg border border-solid p-3"
          >
            <div className="flex items-center gap-2 font-medium">
              <CheckCircleIcon className="h-5 w-5 text-green-500" />
              {result.added} added · {result.updated} updated
            </div>
            <p className="text-description text-sm">
              Your models are available in the chat model selector.
            </p>
            {result.warning && <p className="text-sm">{result.warning}</p>}
            <ul className="m-0 max-h-56 list-none space-y-2 overflow-auto p-0">
              {result.models.map((model) => (
                <li key={model.id} className="flex items-center gap-2 text-sm">
                  <ModelIcon model={model.id} provider="yandex_gpt" />
                  {model.name}
                </li>
              ))}
            </ul>
            {onDone && (
              <Button type="button" onClick={onDone} className="mt-4 w-full">
                Done
              </Button>
            )}
          </div>
        ) : (
          <p role="alert" className="text-error text-sm leading-5">
            {result.message}
          </p>
        ))}
    </form>
  );
}
