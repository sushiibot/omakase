// The UI drift rules fail the lint; UI_DRIFT_STRICT=0 downgrades them to warnings while fixing a batch.
export interface DriftViolation {
	where: string;
	rule: string;
}

export interface DriftMode {
	strict: boolean;
	/** List every violation, not only the per-rule counts. Always on when strict. */
	verbose: boolean;
}

export const modeFromEnv = (env: Record<string, string | undefined> = process.env): DriftMode => ({
	strict: env.UI_DRIFT_STRICT !== '0',
	verbose: env.UI_DRIFT_VERBOSE === '1'
});

/** Prints violations grouped by rule with counts, and returns the exit code. */
export function reportDrift(
	label: string,
	violations: DriftViolation[],
	mode: DriftMode,
	log: (line: string) => void = console.error
): number {
	if (!violations.length) return 0;
	const byRule = new Map<string, string[]>();
	for (const v of violations) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v.where]);
	if (mode.strict || mode.verbose) {
		for (const [rule, wheres] of byRule) {
			log(`\n${rule} (${wheres.length})`);
			for (const where of wheres) log(`  ${where}`);
		}
	}
	log(`\n${label}: ${violations.length} UI drift ${mode.strict ? 'violation(s)' : 'warning(s)'}`);
	for (const [rule, wheres] of byRule) log(`  ${String(wheres.length).padStart(4)}  ${rule}`);
	if (mode.strict) log('Failing on UI drift; UI_DRIFT_STRICT=0 reports it as warnings.');
	else if (!mode.verbose) log('UI_DRIFT_VERBOSE=1 lists each one.');
	return mode.strict ? 1 : 0;
}
