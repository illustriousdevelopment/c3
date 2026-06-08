import { useCallback, useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';

const RELEASE_API_URL = 'https://api.github.com/repos/illustriousdevelopment/c3/releases/latest';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

type UpdateStatus = 'checking' | 'available' | 'up_to_date' | 'error';

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: GitHubAsset[];
}

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string | null;
  latestVersion: string | null;
  downloadUrl: string | null;
  releaseUrl: string | null;
  error: string | null;
}

const initialState: UpdateState = {
  status: 'checking',
  currentVersion: null,
  latestVersion: null,
  downloadUrl: null,
  releaseUrl: null,
  error: null,
};

function normalizeVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l - r;
  }
  return 0;
}

function findDmgAsset(release: GitHubRelease): GitHubAsset | undefined {
  return release.assets.find((asset) => asset.name.endsWith('_aarch64.dmg'))
    ?? release.assets.find((asset) => asset.name.endsWith('.dmg'));
}

export function useUpdateChecker() {
  const [state, setState] = useState<UpdateState>(initialState);

  const checkForUpdates = useCallback(async (silent = false) => {
    if (!silent) {
      setState((prev) => ({ ...prev, status: 'checking', error: null }));
    }

    try {
      const [currentVersion, response] = await Promise.all([
        getVersion(),
        fetch(RELEASE_API_URL, {
          cache: 'no-store',
          headers: { Accept: 'application/vnd.github+json' },
        }),
      ]);

      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}`);
      }

      const release = await response.json() as GitHubRelease;
      const latestVersion = release.tag_name.replace(/^v/i, '');
      const dmgAsset = findDmgAsset(release);
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

      setState({
        status: updateAvailable ? 'available' : 'up_to_date',
        currentVersion,
        latestVersion,
        downloadUrl: dmgAsset?.browser_download_url ?? null,
        releaseUrl: release.html_url,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to check for updates',
      }));
    }
  }, []);

  const openUpdate = useCallback(async () => {
    const target = state.downloadUrl ?? state.releaseUrl;
    if (state.status === 'available' && target) {
      await openUrl(target);
      return;
    }
    await checkForUpdates();
  }, [checkForUpdates, state.downloadUrl, state.releaseUrl, state.status]);

  useEffect(() => {
    checkForUpdates(true);
    const interval = window.setInterval(() => checkForUpdates(true), CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [checkForUpdates]);

  return {
    ...state,
    checkForUpdates,
    openUpdate,
  };
}
