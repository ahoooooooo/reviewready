import { join } from "node:path";
import process from "node:process";

export const LOCAL_NPM_CACHE_DIRECTORY = ".reviewready-npm-cache";

/**
 * Give child npm processes a workspace-local cache when the caller did not
 * choose one. This is process-local and does not modify npm user config.
 *
 * @param {string} projectRoot
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {NodeJS.ProcessEnv}
 */
export function localNpmEnvironment(projectRoot, environment = process.env) {
  const configured = environment.REVIEWREADY_NPM_CACHE?.trim();
  const cache = configured || join(projectRoot, LOCAL_NPM_CACHE_DIRECTORY);
  const childEnvironment = Object.fromEntries(
    Object.entries(environment).filter(([key]) => {
      const normalized = key.toLowerCase();
      return (
        !normalized.startsWith("npm_config_") &&
        normalized !== "node_options" &&
        normalized !== "node_path"
      );
    })
  );
  return {
    ...childEnvironment,
    npm_config_cache: cache,
    NPM_CONFIG_CACHE: cache
  };
}
