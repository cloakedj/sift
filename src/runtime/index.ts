import { Layer } from "effect";
import { FileSystemLive } from "../filesystem/index.js";
import { InventoryLive } from "../inventory/index.js";
import { LexicalLive } from "../lexical/index.js";
import { InspectionLive } from "../onboarding/inspect.js";
import { StoresLive } from "../onboarding/store.js";

const persistence = Layer.mergeAll(InventoryLive, StoresLive).pipe(
  Layer.provideMerge(FileSystemLive),
);
// No provider configuration or paid calls are acquired by credential-free commands.
export const LocalRuntimeLive = Layer.mergeAll(InspectionLive, LexicalLive).pipe(
  Layer.provideMerge(persistence),
);
