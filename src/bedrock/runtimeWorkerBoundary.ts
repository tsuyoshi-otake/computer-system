import type { RemoteCs486ProcessFactory } from "../application/runtime/remoteCs486Process.js";

let installedFactory: RemoteCs486ProcessFactory | undefined;
let installationFinalized = false;

/**
 * Managed-BDS bootstrap installs the companion executor before computerHost is
 * evaluated. Normal pack builds never call this boundary and stay Beta-free.
 */
export function installRuntimeWorkerFactory(
  factory: RemoteCs486ProcessFactory,
): void {
  if (installationFinalized) {
    throw new Error("Runtime worker factory is already installed");
  }
  installationFinalized = true;
  installedFactory = factory;
}

export function runtimeWorkerFactory(): RemoteCs486ProcessFactory | undefined {
  return installedFactory;
}
