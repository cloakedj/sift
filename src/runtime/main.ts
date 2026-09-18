import { Effect, Exit } from "effect";
import { Errors, type AppError } from "../errors/index.js";
import type { MessageService } from "../messages/index.js";

export class ApplicationRuntime {
  public static async run(
    program: Effect.Effect<number, AppError>,
    output: MessageService,
  ): Promise<void> {
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    try {
      const exit = await Effect.runPromiseExit(program, { signal: controller.signal });
      if (Exit.isSuccess(exit)) process.exitCode = exit.value;
      else {
        const error = Errors.fromCause(exit.cause);
        await Effect.runPromiseExit(output.error("CLI", error));
        process.exitCode = error.code === "INTERRUPTED" ? 130 : 1;
      }
    } finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    }
  }
}
