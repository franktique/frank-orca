# Contract: Script sandbox (`pm` API subset)

Runtime: QuickJS (`quickjs-emscripten`) in a worker thread; fresh context per script; 32 MB memory, 5 s timeout; no filesystem, network, timers beyond the script, or Node globals (research R6).

## Supported (FR-015)

| API                                                                                                                          | Phase | Notes                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `pm.test(name, fn)`                                                                                                          | both  | Exceptions inside `fn` → failed test with message.                                                          |
| `pm.expect(value)`                                                                                                           | both  | Bundled `chai` BDD `expect`.                                                                                |
| `pm.response.code`, `.status`, `.headers.get(name)`, `.responseTime`, `.responseSize`                                        | test  |                                                                                                             |
| `pm.response.json()`, `.text()`                                                                                              | test  | `json()` throws a readable error on invalid JSON.                                                           |
| `pm.response.to.have.status(n)`, `.to.be.ok`, `.to.have.header(name)`, `.to.have.jsonBody(...)`                              | test  | Common chai-postman assertions.                                                                             |
| `pm.request.url`, `.method`, `.headers` (get/add/upsert/remove), `.body`                                                     | both  | Pre-request mutations apply to the outgoing request.                                                        |
| `pm.environment.get/set/unset/has`                                                                                           | both  | Writes go to the run's working copy; committed after the request. Agent runs follow the same rule (FR-035). |
| `pm.collectionVariables.get/set/unset/has`                                                                                   | both  |                                                                                                             |
| `pm.variables.get/set/has`                                                                                                   | both  | Request-local scope; `get` resolves through all scopes (R7).                                                |
| `pm.info.requestName`, `.requestId`, `.iteration`, `.eventName`                                                              | both  |                                                                                                             |
| `console.log/info/warn/error`                                                                                                | both  | Captured into `scriptLogs` and the console (acceptance 2.3).                                                |
| Legacy: `tests["name"] = bool`, `responseBody`, `responseCode.code`, `postman.setEnvironmentVariable/getEnvironmentVariable` | test  | Present in many older collections.                                                                          |
| `JSON`, `Math`, `Date`, `atob`, `btoa`, `crypto.randomUUID`                                                                  | both  | Pure helpers implemented inside the sandbox.                                                                |

## Not supported (throws `NotSupportedError`)

`pm.sendRequest`, `pm.visualizer`, `pm.cookies`, `pm.require`, `pm.execution.setNextRequest` (also `postman.setNextRequest`), `require()` of anything except `chai`, `setTimeout` beyond a no-op shim. The error message names the API (spec Edge Cases). Import lists collections/requests using these as warnings.

## Execution order per request

collection prerequest → folder prerequests (outer → inner) → request prerequest → **send** → collection test → folder tests → request test (Postman order). A thrown error in a prerequest script aborts the send and records `script-error`.
