import { type Player } from "@minecraft/server";
import { uiManager } from "@minecraft/server-ui";
import {
  Background,
  Form,
  Panel,
  Text,
  render,
  useExit,
  type FormValues,
  type JSX,
} from "@bedrock-core/ui";

import {
  ManagedTerminalSession,
  type TerminalSessionEvent,
} from "../application/terminal/session.js";
import { renderPlainTerminalRows } from "../application/terminal/viewport.js";
import type { TerminalBuffer } from "../domain/terminal/terminalBuffer.js";
import type { TerminalViewHandlers } from "./terminalView.js";

const black = "textures/ui/Black";
interface CustomTerminalFormProps {
  readonly terminal: TerminalBuffer;
  readonly title: string;
  readonly onSubmitLine: (line: string) => "continue" | "close";
  readonly onCancel: () => void;
}

export function showCustomTerminalView(
  player: Player,
  terminal: TerminalBuffer,
  handlers: TerminalViewHandlers,
  title = "Computer System",
): void {
  const session = new ManagedTerminalSession((event): void =>
    dispatch(event, handlers),
  );

  const submitLine = (line: string): "continue" | "close" => {
    try {
      session.submitLine(line);
      return "continue";
    } catch (error: unknown) {
      reportFailure(player, session, error);
      return "close";
    }
  };
  const cancel = (): void => {
    try {
      if (session.requestTermination()) handlers.onTerminate();
      session.finalizeClose("ServerClosed");
    } catch (error: unknown) {
      reportFailure(player, session, error);
    }
  };

  try {
    render(
      <CustomTerminalForm
        terminal={terminal}
        title={title}
        onSubmitLine={submitLine}
        onCancel={cancel}
      />,
      player,
    );
  } catch (error: unknown) {
    reportFailure(player, session, error);
    uiManager.closeAllForms(player);
  }
}

function CustomTerminalForm({
  terminal,
  title,
  onSubmitLine,
  onCancel,
}: CustomTerminalFormProps): JSX.Element {
  const exit = useExit();
  const submit = (values: FormValues): void => {
    const value = values.command;
    const outcome = onSubmitLine(typeof value === "string" ? value : "");
    if (outcome === "close") exit();
  };
  const cancel = (): void => {
    onCancel();
    exit();
  };
  const rows = renderPlainTerminalRows(terminal);

  return (
    <Form onSubmit={submit} onCancel={cancel}>
      <Background texture={black} />
      <Panel
        width={"100%"}
        height={"100%"}
        flexDirection={"column"}
        gap={4}
        padding={8}
        background={black}
      >
        <Text width={"100%"} height={12} scale={0.72}>
          {`§f${title}`}
        </Text>
        <Panel
          flex={1}
          width={"100%"}
          flexDirection={"column"}
          gap={1}
          padding={4}
          background={black}
        >
          {rows.map((row) => (
            <Text width={"100%"} height={8} scale={0.6}>
              {`§f${row}`}
            </Text>
          ))}
        </Panel>
        <Panel
          width={"100%"}
          height={18}
          flexDirection={"row"}
          alignItems={"center"}
          gap={2}
          background={black}
        >
          <Text width={14} height={10} scale={0.65}>
            {"§f~$"}
          </Text>
          <Form.Input
            name={"command"}
            placeholder={"type a command"}
            defaultValue={""}
            flex={1}
            height={18}
            scale={0.65}
            background={black}
            backgroundHover={black}
            backgroundPressed={black}
            backgroundLocked={black}
          />
        </Panel>
        <Form.Button
          type={"submit"}
          label={""}
          visible={false}
          width={0}
          height={0}
        />
      </Panel>
    </Form>
  );
}

function dispatch(
  event: TerminalSessionEvent,
  handlers: TerminalViewHandlers,
): void {
  if (event.type === "terminal_line") handlers.onLine(event.line);
  else handlers.onClosed(event.result.kind, event.result.detail);
}

function reportFailure(
  player: Player,
  session: ManagedTerminalSession,
  error: unknown,
): void {
  const result = session.finalizeFailure(error, player.isValid);
  console.error(
    `CS_CUSTOM_TERMINAL_ERROR ${JSON.stringify({
      kind: result.kind,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    })}`,
  );
  if (player.isValid)
    player.sendMessage(
      `Custom terminal failed: ${result.detail ?? result.kind}`,
    );
}
