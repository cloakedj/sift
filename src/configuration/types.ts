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
  };
}

export interface ResolvedConfig {
  path?: string;
  base: string;
  config: SiftConfig;
}
