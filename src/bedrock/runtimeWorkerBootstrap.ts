import { installRuntimeWorkerFactory } from "./runtimeWorkerBoundary.js";
import { createManagedRuntimeWorkerFactory } from "./runtimeWorkerClient.js";

const factory = createManagedRuntimeWorkerFactory();
installRuntimeWorkerFactory(factory);
console.warn(
  `CS_RUNTIME_WORKER_READY ${JSON.stringify({ workerCount: factory.workerCount })}`,
);
