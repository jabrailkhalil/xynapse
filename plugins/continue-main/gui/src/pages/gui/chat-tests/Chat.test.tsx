import { act, waitFor } from "@testing-library/react";
import { MessageModes } from "core";
import {
  addAndSelectChatModel,
  addAndSelectMockLlm,
} from "../../../util/test/config";
import { setMode } from "../../../redux/slices/sessionSlice";
import { renderWithProviders } from "../../../util/test/render";
import {
  getElementByTestId,
  getElementByText,
  sendInputWithMockedResponse,
} from "../../../util/test/utils";
import { Chat } from "../Chat";

test("should render input box", async () => {
  await renderWithProviders(<Chat />);
  await getElementByTestId("continue-input-box-main-editor-input");
});

test("should be able to toggle modes", async () => {
  await renderWithProviders(<Chat />);
  await getElementByText("Edit");

  // Simulate cmd+. keyboard shortcut to toggle modes
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        metaKey: true, // cmd key on Mac
      }),
    );
  });

  // Xynapse cycles Edit -> Full -> Chat -> Plan -> Edit.
  await getElementByText("Full");

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        metaKey: true, // cmd key on Mac
      }),
    );
  });

  await getElementByText("Chat");

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: ".", metaKey: true }),
    );
  });
  await getElementByText("Plan");

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: ".", metaKey: true }),
    );
  });
  await getElementByText("Edit");
});

test("should send a message and receive a response", async () => {
  const { ideMessenger, store } = await renderWithProviders(<Chat />);

  // First add and select the mock LLM
  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
    store.dispatch(setMode("chat"));
  });

  const CONTENT = "Expected response";
  const INPUT = "User input";

  await sendInputWithMockedResponse(ideMessenger, INPUT, [
    { role: "assistant", content: CONTENT },
  ]);

  await getElementByText(CONTENT);
});

test.each([
  ["agent", "workspace-write", false],
  ["plan", "read-only", true],
  ["full", "danger-full-access", false],
] as const)(
  "routes %s mode through the runtime with %s permissions",
  async (mode, permissionMode, planMode) => {
    const { ideMessenger, store } = await renderWithProviders(<Chat />);

    await act(async () => {
      addAndSelectChatModel(store, ideMessenger, {
        model: "yandexgpt-5-pro",
        provider: "yandex_gpt",
        title: "YandexGPT Pro 5",
        underlyingProviderName: "yandex_gpt",
      });
      store.dispatch(setMode(mode as MessageModes));
    });

    await sendInputWithMockedResponse(ideMessenger, `${mode} task`, []);

    await waitFor(() => {
      const runtimeMessage = ideMessenger.postedMessages.find(
        (message) => message.messageType === "xynapse/runtimePrompt",
      );
      expect(runtimeMessage).toBeDefined();
      expect(runtimeMessage?.data).toMatchObject({
        prompt: `${mode} task`,
        permissionMode,
        planMode,
        surface: "core",
      });
    });
  },
);
