import { Effect } from "effect";
import { ConfigurationPath } from "../configuration/index.js";
import { Errors } from "../errors/index.js";
import { Messages, type MessageService } from "../messages/index.js";
import { BenchmarkCommands } from "./commands/benchmark.js";
import { InspectionCommands } from "./commands/inspection.js";
import { LexicalCommands } from "./commands/lexical.js";
import { OnboardingCommand } from "./commands/onboarding.js";
import { PublicationCommands } from "./commands/publication.js";
import { SearchCommand } from "./commands/search.js";
import { USAGE } from "./consts.js";
import { CorpusResolver, ResolvedCorpus } from "./corpus/index.js";
import { configurationArgs } from "./utils.js";

export class CliApplication {
  public constructor(private readonly _output: MessageService) {}

  public run(command: string | undefined, args: string[]) {
    return Effect.gen(this, function* () {
      const parsed = yield* Errors.attempt(() => configurationArgs(args), "INVALID_ARGUMENT");
      return yield* Effect.gen(this, function* () {
        const resolved = yield* new CorpusResolver().resolve(command, parsed.args, parsed.config);
        return yield* this._run(command, resolved.args).pipe(
          Effect.provideService(ResolvedCorpus, resolved.resolution),
        );
      }).pipe(Effect.provideService(ConfigurationPath, parsed.config));
    });
  }

  private _run(command: string | undefined, args: string[]) {
    return Effect.gen(this, function* () {
      switch (command) {
        case "onboard":
          return yield* new OnboardingCommand(this._output).run(args);
        case "inspect":
          return yield* new InspectionCommands(this._output).inspect(args);
        case "repair-projections":
          return yield* new InspectionCommands(this._output).repairProjections(args);
        case "search":
          return yield* new SearchCommand(this._output).run(args);
        case "publish":
          return yield* new PublicationCommands(this._output).publish(args);
        case "status":
          return yield* new PublicationCommands(this._output).status(args);
        case "generate-scale-corpus":
          return yield* new BenchmarkCommands(this._output).generateScaleCorpus(args);
        case "benchmark-summary":
          return yield* new BenchmarkCommands(this._output).summary(args);
        case "evaluate-relevance":
          return yield* new BenchmarkCommands(this._output).evaluateRelevance(args);
        case "benchmark-relevance":
          return yield* new BenchmarkCommands(this._output).relevance(args);
        case "index":
        case "lexical-search":
          return yield* new LexicalCommands(this._output).run(
            command === "index" ? "index" : "search",
            args,
          );
        default:
          if (command && command !== "help" && command !== "--help")
            return yield* Errors.fail("INVALID_ARGUMENT", `Unknown command: ${command}`);
          for (const text of USAGE)
            yield* this._output.report({ label: "Usage", level: "info", text });
          return 0;
      }
    });
  }
}

export const runCli = (command: string | undefined, args: string[]) =>
  Effect.flatMap(Messages, (output) => new CliApplication(output).run(command, args));
