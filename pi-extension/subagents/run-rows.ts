import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RunningSubagent } from "@nubl/maestro/pi/subagents/state";
import { projectLifecycle } from "@nubl/maestro/core/lifecycle";

export class RunRows {
	private claims = new Map<string, { ids: Set<string>; expires: number }>();
	private prune(now: number) {
		for (const [key, c] of this.claims)
			if (c.expires <= now) this.claims.delete(key);
	}
	claimed() {
		this.prune(performance.now());
		return new Set([...this.claims.values()].flatMap((c) => [...c.ids]));
	}
	register(pi: ExtensionAPI, runs: Map<string, RunningSubagent>) {
		// Validate third-party event payloads at the bus boundary.
		/* oxlint-disable anti-slop/no-runtime-typeof */
		const off = pi.events.on("pi-herdr-agents:run-rows:v1", (raw) => {
			if (!raw || typeof raw !== "object") return;
			const now = Date.now();
			const leaseTime = performance.now();
			this.prune(leaseTime);
			const rows = Array.from(runs.values(), (r) => {
				const {
					kind,
					label,
					stateDurationSince: since,
				} = projectLifecycle(r.lifecycle, now);
				return {
					id: r.id,
					name: r.name,
					...(r.agent && { agent: r.agent }),
					...(r.runtimePlan && {
						model: r.runtimePlan.modelId,
						thinking: r.runtimePlan.thinking,
					}),
					startedAt: r.startTime,
					phase: {
						kind,
						...(label !== undefined && { label }),
						...(since != null && { since }),
					},
					...(r.cancelState && {
						cancel:
							r.cancelState === "unconfirmed" ? "unconfirmed" : "requested",
					}),
				};
			});
			Object.assign(raw, { rows: { version: 1, rows } });
			const c = "claim" in raw && raw.claim;
			if (
				!c ||
				typeof c !== "object" ||
				!("by" in c) ||
				typeof c.by !== "string" ||
				!c.by ||
				!("ids" in c) ||
				!Array.isArray(c.ids)
			)
				return;
			const ids = new Set<string>(
				c.ids.filter(
					(id): id is string => typeof id === "string" && runs.has(id),
				),
			);
			if (ids.size) this.claims.set(c.by, { ids, expires: leaseTime + 3000 });
			else this.claims.delete(c.by);
		});
		/* oxlint-enable anti-slop/no-runtime-typeof */
		pi.on("session_shutdown", () => {
			off();
			this.claims.clear();
		});
	}
}
