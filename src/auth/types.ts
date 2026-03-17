export interface AuthConfig {
  userLogin: string;
  owner: string;
  repo: string;
  installationToken: string;
  installationTokenExpiresAt: string;
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
