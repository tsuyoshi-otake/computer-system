// Dependency order is intentional: the managed-only Beta API adapter installs
// the worker factory before main evaluates computerHost's singleton.
import "./runtimeWorkerBootstrap.js";
import "./main.js";
