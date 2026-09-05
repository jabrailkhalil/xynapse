import { FromWebviewProtocol, ToWebviewProtocol } from "core/protocol";
import { Message } from "core/protocol/messenger";
import { publicErrorMessage } from "core/util/publicError";
import { Telemetry } from "core/util/posthog";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";

import { IMessenger } from "../../../core/protocol/messenger";

export class VsCodeWebviewProtocol
  implements IMessenger<FromWebviewProtocol, ToWebviewProtocol>
{
  listeners = new Map<
    keyof FromWebviewProtocol,
    ((message: Message) => any)[]
  >();

  send(messageType: string, data: any, messageId?: string): string {
    const id = messageId ?? uuidv4();
    this.webview?.postMessage({
      messageType,
      data,
      messageId: id,
    });
    return id;
  }

  on<T extends keyof FromWebviewProtocol>(
    messageType: T,
    handler: (
      message: Message<FromWebviewProtocol[T][0]>,
    ) => Promise<FromWebviewProtocol[T][1]> | FromWebviewProtocol[T][1],
  ): void {
    if (!this.listeners.has(messageType)) {
      this.listeners.set(messageType, []);
    }
    this.listeners.get(messageType)?.push(handler);
  }

  _webview?: vscode.Webview;
  _webviewListener?: vscode.Disposable;

  get webview(): vscode.Webview | undefined {
    return this._webview;
  }

  set webview(webView: vscode.Webview) {
    this._webview = webView;
    this._webviewListener?.dispose();

    const handleMessage = async (msg: Message): Promise<void> => {
      if (!("messageType" in msg) || !("messageId" in msg)) {
        throw new Error("Invalid webview protocol message");
      }

      const respond = (message: any) =>
        this.send(msg.messageType, message, msg.messageId);

      const handlers =
        this.listeners.get(msg.messageType as keyof FromWebviewProtocol) || [];
      for (const handler of handlers) {
        try {
          const response = await handler(msg);
          // For generator types e.g. llm/streamChat
          if (
            response &&
            typeof response[Symbol.asyncIterator] === "function"
          ) {
            let next = await response.next();
            while (!next.done) {
              respond({
                done: false,
                content: next.value,
                status: "success",
              });
              next = await response.next();
            }
            respond({
              done: true,
              content: next.value,
              status: "success",
            });
          } else {
            respond({ done: true, content: response, status: "success" });
          }
        } catch (error: unknown) {
          const message = publicErrorMessage(error);
          respond({ done: true, error: message, status: "error" });
          const expectedProbe =
            msg.messageType === "subprocess" &&
            ["where cn", "which cn", "command -v cn || true"].includes(
              (msg.data as { command?: string })?.command ?? "",
            );
          if (!expectedProbe) {
            // Request bodies, errors and stacks can contain credentials or source text.
            // Only the registered protocol name is safe to record here.
            console.error("Xynapse request failed", {
              messageType: msg.messageType,
            });
            void Telemetry.capture(
              "webview_protocol_error",
              {
                messageType: msg.messageType,
              },
              false,
            );
          }
        }
      }
    };

    this._webviewListener = this._webview.onDidReceiveMessage(handleMessage);
  }

  constructor() {}

  invoke<T extends keyof FromWebviewProtocol>(
    messageType: T,
    data: FromWebviewProtocol[T][0],
    messageId?: string,
  ): FromWebviewProtocol[T][1] {
    throw new Error("Method not implemented.");
  }

  onError(handler: (message: Message, error: Error) => void): void {
    throw new Error("Method not implemented.");
  }

  public request<T extends keyof ToWebviewProtocol>(
    messageType: T,
    data: ToWebviewProtocol[T][0],
    retry: boolean = true,
  ): Promise<ToWebviewProtocol[T][1]> {
    const messageId = uuidv4();
    return new Promise(async (resolve) => {
      if (retry) {
        let i = 0;
        while (!this.webview) {
          if (i >= 10) {
            resolve(undefined);
            return;
          } else {
            await new Promise((res) => setTimeout(res, i >= 5 ? 1000 : 500));
            i++;
          }
        }
      }

      this.send(messageType, data, messageId);

      if (this.webview) {
        const disposable = this.webview.onDidReceiveMessage(
          (msg: Message<ToWebviewProtocol[T][1]>) => {
            if (msg.messageId === messageId) {
              resolve(msg.data);
              disposable?.dispose();
            }
          },
        );
      } else if (!retry) {
        resolve(undefined);
      }
    });
  }
}
