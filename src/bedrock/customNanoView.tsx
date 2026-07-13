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

import type {
  NanoEditorSession,
  NanoEditorResult,
  NanoEditorSnapshot,
} from "../application/editor/nanoSession.js";

const black = "textures/ui/Black";

export interface NanoViewHandlers {
  readonly onSave: (snapshot: NanoEditorSnapshot) => void;
  readonly onClosed: (
    result: Extract<NanoEditorResult, { kind: "closed" }>,
  ) => void;
}

interface NanoFormProps {
  readonly editor: NanoEditorSession;
  readonly handlers: NanoViewHandlers;
}

export function showCustomNanoView(
  player: Player,
  editor: NanoEditorSession,
  handlers: NanoViewHandlers,
): void {
  try {
    render(<NanoForm editor={editor} handlers={handlers} />, player);
  } catch (error: unknown) {
    console.error(`CS_NANO_ERROR ${String(error)}`);
    uiManager.closeAllForms(player);
  }
}

function NanoForm({ editor, handlers }: NanoFormProps): JSX.Element {
  const exit = useExit();
  const snapshot = editor.snapshot;
  const rows = editor.visibleRows(12);
  const submit = (values: FormValues): void => {
    const value = values.line;
    const result = editor.submit(typeof value === "string" ? value : "");
    if (result.kind === "saved") handlers.onSave(result.snapshot);
    if (result.kind === "closed") {
      if (result.saved) handlers.onSave(result.snapshot);
      handlers.onClosed(result);
      exit();
    }
  };
  const cancel = (): void => {
    const result = editor.cancel();
    if (result.kind === "closed") handlers.onClosed(result);
    exit();
  };

  return (
    <Form onSubmit={submit} onCancel={cancel}>
      <Background texture={black} />
      <Panel
        width={"100%"}
        height={"100%"}
        flexDirection={"column"}
        gap={2}
        padding={8}
        background={black}
      >
        <Text width={"100%"} height={10} scale={0.62}>
          {`§f  GNU nano 8.0    ${safe(snapshot.fileName)}${snapshot.dirty ? "  Modified" : ""}`}
        </Text>
        <Panel
          flex={1}
          width={"100%"}
          flexDirection={"column"}
          gap={1}
          padding={2}
          background={black}
        >
          {rows.map((row) => (
            <Text width={"100%"} height={8} scale={0.56}>
              {`${row.active ? "§f>" : "§7 "}${row.lineNumber.toString().padStart(3, " ")} §f${safe(row.text).slice(0, 68)}`}
            </Text>
          ))}
        </Panel>
        <Text width={"100%"} height={9} scale={0.55}>
          {`§7${safe(snapshot.status)}`}
        </Text>
        <Text width={"100%"} height={9} scale={0.55}>
          {"§fEnter Next   :w Write   :q Quit   :up/:down Move"}
        </Text>
        <Panel
          width={"100%"}
          height={18}
          flexDirection={"row"}
          alignItems={"center"}
          gap={2}
          background={black}
        >
          <Text width={36} height={10} scale={0.58}>
            {`§f${(snapshot.currentLine + 1).toString().padStart(3, " ")} >`}
          </Text>
          <Form.Input
            name={"line"}
            placeholder={"edit current line"}
            defaultValue={snapshot.lines[snapshot.currentLine] ?? ""}
            flex={1}
            height={18}
            scale={0.62}
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

function safe(value: string): string {
  return value.replaceAll("§", "?");
}
