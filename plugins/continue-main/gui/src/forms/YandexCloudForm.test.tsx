import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IdeMessengerContext, IIdeMessenger } from "../context/IdeMessenger";
import { YandexCloudForm } from "./YandexCloudForm";

function setup(request: ReturnType<typeof vi.fn>) {
  const done = vi.fn();
  render(
    <IdeMessengerContext.Provider
      value={{ request, post: vi.fn() } as unknown as IIdeMessenger}
    >
      <YandexCloudForm onDone={done} />
    </IdeMessengerContext.Provider>,
  );
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: " test-ui-key " },
  });
  fireEvent.change(screen.getByLabelText("Folder ID"), {
    target: { value: " test-folder " },
  });
  return done;
}

describe("Yandex Cloud connection", () => {
  it("masks the key, imports once and shows models with family icons", async () => {
    let complete!: (value: unknown) => void;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const done = setup(request);
    expect(screen.getByLabelText("API key")).toHaveAttribute(
      "type",
      "password",
    );
    const form = screen.getByRole("form", { name: "Connect Yandex Cloud" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("config/importYandexCloud", {
      apiKey: "test-ui-key",
      folderId: "test-folder",
    });
    expect(
      screen.getByRole("button", { name: "Connecting and importing…" }),
    ).toBeDisabled();
    complete({
      status: "success",
      content: {
        ok: true,
        added: 2,
        updated: 0,
        models: [
          { id: "deepseek-v4-flash/latest", name: "DeepSeek V4 Flash" },
          { id: "qwen3.6-35b-a3b/latest", name: "Qwen3.6 35B" },
        ],
      },
    });
    await screen.findByRole("status");
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(
      screen.getByText("DeepSeek V4 Flash").querySelector("img"),
    ).toHaveAttribute("src", "/logos/deepseek.png");
    expect(
      screen.getByText("Qwen3.6 35B").querySelector("img"),
    ).toHaveAttribute("src", "/logos/qwen.png");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(done).toHaveBeenCalledOnce();
  });

  it("shows a safe failure and allows another attempt", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new Error("test-ui-key in a raw exception"));
    setup(request);
    fireEvent.submit(screen.getByRole("form"));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).not.toHaveTextContent("test-ui-key");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Connect and import all models" }),
      ).toBeEnabled(),
    );
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
});
