import { Errors } from "../../errors/index.js";
import { evaluateCases } from "./utils.js";

export const evaluateRelevance = (cases: unknown, k: number) =>
  Errors.attempt(() => evaluateCases(cases, k), "INVALID_DATA");
