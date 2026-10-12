// How agent prompts refer to the owner: their display name when one is set, otherwise "the user".

type Name = string | null | undefined;

export function ownerLabel(name: Name): string {
  return name || "the user";
}

/** For the start of a sentence. */
export function ownerLabelStart(name: Name): string {
  return name || "The user";
}

export function ownerPossessive(name: Name): string {
  return name ? `${name}'s` : "the user's";
}

/** The system-prompt line that names the user; undefined when no name is set. */
export function ownerNameLine(name: Name): string | undefined {
  return name ? `The user's name is ${name}.` : undefined;
}
