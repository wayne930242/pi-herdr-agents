import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

const WINDOWS_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
	const key = Object.keys(env).find(
		(candidate) => candidate.toUpperCase() === name,
	);
	return key === undefined ? undefined : env[key];
}

/** Candidate file names for `name` in one PATH directory. */
function executableFileNames(
	name: string,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): string[] {
	if (platform !== "win32") return [name];
	const pathext = envValue(env, "PATHEXT") || WINDOWS_DEFAULT_PATHEXT;
	return pathext
		.split(";")
		.map((extension) => extension.trim())
		.filter((extension) => extension.length > 0)
		.map((extension) => `${name}${extension}`);
}

/**
 * Pure PATH probe: no process spawn, one bounded stat per directory and name.
 * Windows executables carry a PATHEXT extension, so `herdr` is `herdr.exe`.
 */
export function executableOnPath(
	name: string,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): boolean {
	const names = executableFileNames(name, platform, env);
	return (envValue(env, "PATH") ?? "").split(delimiter).some((directory) =>
		names.some((candidate) => {
			try {
				const path = join(directory, candidate);
				accessSync(path, constants.X_OK);
				return statSync(path).isFile();
			} catch {
				return false;
			}
		}),
	);
}
