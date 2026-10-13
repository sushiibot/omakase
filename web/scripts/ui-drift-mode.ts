// The UI drift rules warn until the tree is migrated; UI_DRIFT_STRICT=1 makes them fail the lint.
export interface DriftViolation {
	where: string;
	rule: string;
}

export const strict = process.env.UI_DRIFT_STRICT === '1';

/** Prints violations grouped by rule with counts, and returns the exit code. */
export function reportDrift(
	label: string,
	violations: DriftViolation[],
	isStrict: boolean,
	log: (line: string) => void = console.error
): number {
	if (!violations.length) return 0;
	const byRule = new Map<string, string[]>();
	for (const v of violations) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v.where]);
	for (const [rule, wheres] of byRule) {
		log(`\n${rule} (${wheres.length})`);
		for (const where of wheres) log(`  ${where}`);
	}
	log(`\n${label}: ${violations.length} UI drift ${isStrict ? 'violation(s)' : 'warning(s)'}`);
	for (const [rule, wheres] of byRule) log(`  ${String(wheres.length).padStart(4)}  ${rule}`);
	if (!isStrict) log('Set UI_DRIFT_STRICT=1 to fail on these.');
	return isStrict ? 1 : 0;
}
