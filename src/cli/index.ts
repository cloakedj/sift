import { Effect, Layer } from "effect";
import { Messages, MessageService } from "../messages/index.js";
import { LocalRuntimeLive } from "../runtime/index.js";
import { ApplicationRuntime } from "../runtime/main.js";
import { runCli } from "./application.js";

const [, , command, ...args] = process.argv;
const output = new MessageService({ diagnosticsToStderr: args.includes("--json") });
const program = runCli(command, args).pipe(
  Effect.provide(Layer.merge(LocalRuntimeLive, Layer.succeed(Messages, output))),
);
void ApplicationRuntime.run(program, output);
