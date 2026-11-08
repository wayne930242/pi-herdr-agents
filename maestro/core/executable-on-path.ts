import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

const WINDOWS_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Windows env names are case-insensitive; elsewhere they are exact. */
function envValue(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
	name: string,
): string | undefined {
	if (platform !== "win32") return env[name];
	const key = Object.keys(env).find(
		(candidate) => candidate.toUpperCase() === name,
	);
	return key === undefined ? undefined : env[key];
}

/** where.exe and libuv strip one pair of quotes from a Windows PATH entry. */
function pathDirectory(directory: string, platform: NodeJS.Platform): string {
	return platform === "win32" && /^".*"$/s.test(directory)
		? directory.slice(1, -1)
		: directory;
}

/** Candidate file names for `name` in one PATH directory. */
function executableFileNames(
	name: string,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): string[] {
	if (platform !== "win32") return [name];
	const pathext = envValue(env, platform, "PATHEXT") || WINDOWS_DEFAULT_PATHEXT;
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
	return (envValue(env, platform, "PATH") ?? "")
		.split(delimiter)
		.some((entry) =>
			names.some((candidate) => {
				try {
					const path = join(pathDirectory(entry, platform), candidate);
					accessSync(path, constants.X_OK);
					return statSync(path).isFile();
				} catch {
					return false;
				}
			}),
		);
}
