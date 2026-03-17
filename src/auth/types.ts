export interface AuthConfig {
  mode: 'app' | 'token';
  userLogin: string;
  owner: string;
  repo: string;
  /** App mode: installation token for bot operations */
  installationToken?: string;
  /** App mode: ISO 8601 expiry of installation token */
  installationTokenExpiresAt?: string;
  /** Token mode (legacy): personal access token */
  personalToken?: string;
}

export interface CachedAuth {
  userToken: string;
  userLogin: string;
}

export interface InstallationInfo {
  id: number;
  account: string;
  repositories: Array<{ full_name: string; name: string }>;
}
