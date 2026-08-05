/** A complete choice: one option id per resolved layer. */
export type Selection = Readonly<Record<string, string>>;

/** A partial, user-provided choice. Missing layers are filled in by the engine. */
export type SelectionInput = Readonly<Record<string, string | undefined>>;
