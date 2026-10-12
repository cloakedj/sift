export interface SiftConfig {
  version: 1;
  discovery?: {
    include?: string[];
    exclude?: string[];
    respectGitignore?: boolean;
    hiddenDirectories?: boolean;
  };
  onboarding?: {
    limit?: number;
    concurrency?: number;
    rerunGovernance?: boolean;
    /** Default true. Reuse Jev answers per (content, question, question-set version, model) instead of per whole request. */
    labelCache?: boolean;
    /** Default true. Reuse taxonomy judgments per candidate identity; only newly harvested candidates are judged. Set false (or use rerunGovernance) to re-judge everything. */
    stableTaxonomy?: boolean;
  };
}

export interface ResolvedConfig {
  path?: string;
  base: string;
  config: SiftConfig;
}
