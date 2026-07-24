import { system } from "@minecraft/server";
import { secrets, variables, type SecretString } from "@minecraft/server-admin";
import {
  HttpHeader,
  websocket,
  type WebSocketClient,
} from "@minecraft/server-net";

import { RemoteCs486ProcessFactory } from "../application/runtime/remoteCs486Process.js";
import {
  Cs486WorkerSocketTransport,
  type Cs486WorkerTextSocket,
} from "../application/runtime/cs486WorkerSocketTransport.js";

const endpointVariableName = "cs486ComputeEndpoint";
const workerCountVariableName = "cs486RuntimeWorkerCount";
const authorizationSecretName = "cs486ComputeToken";
const computePath = "/internal/cs486/v1";
const requestTimeoutTicks = 200;

export function createManagedRuntimeWorkerFactory(): RemoteCs486ProcessFactory {
  const endpoint = requireComputeEndpoint(variables.get(endpointVariableName));
  const workerCount = requireWorkerCount(
    variables.get(workerCountVariableName),
  );
  const authorization = requireAuthorizationSecret(
    secrets.get(authorizationSecretName),
  );
  const transport = new Cs486WorkerSocketTransport({
    cancelTimeout: (handle): void => {
      if (typeof handle === "number") system.clearRun(handle);
    },
    connect: async (): Promise<Cs486WorkerTextSocket> =>
      wrapWebSocketClient(
        await websocket.connect(endpoint, [
          new HttpHeader("Authorization", authorization),
        ]),
      ),
    requestTimeoutTicks,
    scheduleTimeout: (listener, timeoutTicks): number =>
      system.runTimeout(listener, timeoutTicks),
    workerCount,
  });
  return new RemoteCs486ProcessFactory(transport);
}

function wrapWebSocketClient(client: WebSocketClient): Cs486WorkerTextSocket {
  return {
    get isOpen(): boolean {
      return client.isOpen;
    },
    close(): void {
      client.close();
    },
    send(payload: string): void {
      client.send(payload);
    },
    subscribeClose(listener: () => void): void {
      client.afterEvents.close.subscribe((): void => listener());
    },
    subscribeMessage(listener: (payload: string) => void): void {
      client.afterEvents.message.subscribe((event): void =>
        listener(event.message),
      );
    },
  };
}

function requireComputeEndpoint(value: unknown): string {
  if (typeof value !== "string")
    throw new Error(
      `Managed BDS variable ${endpointVariableName} must be configured`,
    );
  const match =
    /^ws:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/internal\/cs486\/v1$/u.exec(value);
  const port = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (
    match === null ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    value !== `ws://127.0.0.1:${String(port)}${computePath}`
  )
    throw new Error(
      `Managed BDS variable ${endpointVariableName} must use the exact loopback compute endpoint`,
    );
  return value;
}

function requireWorkerCount(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 16
  )
    throw new Error(
      `Managed BDS variable ${workerCountVariableName} must be an integer from 1 through 16`,
    );
  return value as number;
}

function requireAuthorizationSecret(
  value: SecretString | undefined,
): SecretString {
  if (value === undefined)
    throw new Error(
      `Managed BDS secret ${authorizationSecretName} must be configured`,
    );
  return value;
}
