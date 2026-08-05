import {
  formatTargetRef,
  parseTargetRef,
  type Constraint,
  type PluginManifest,
} from '@klairox/plugin-sdk';
import type { SelectionInput } from '../selection/selection.types.js';

export interface RuleEvaluation {
  /** Target ref (`layer` or `layer:option`) mapped to the constraint that disabled it. */
  readonly disabledTargets: ReadonlyMap<string, string>;
  /** Target ref mapped to the constraint that requires it. */
  readonly requiredTargets: ReadonlyMap<string, string>;
  /** Layers excluded from the render, mapped to the constraint that hid them. */
  readonly hiddenLayers: ReadonlyMap<string, string>;
  readonly matchedConstraints: readonly string[];
}

export interface RuleViolation {
  readonly constraint: string;
  readonly message: string;
}

/**
 * Applies every constraint whose condition matches the (possibly partial) selection.
 * Pure and synchronous, so the editor can call it on each keystroke.
 */
export function evaluateConstraints(
  manifest: PluginManifest,
  selection: SelectionInput,
): RuleEvaluation {
  const disabledTargets = new Map<string, string>();
  const requiredTargets = new Map<string, string>();
  const hiddenLayers = new Map<string, string>();
  const matchedConstraints: string[] = [];

  manifest.constraints.forEach((constraint, constraintIndex) => {
    if (!matches(constraint, selection)) {
      return;
    }

    const label = constraintLabel(constraint, constraintIndex);
    matchedConstraints.push(label);

    for (const target of constraint.disable) {
      setIfAbsent(disabledTargets, target, label);
    }
    for (const target of constraint.require) {
      setIfAbsent(requiredTargets, target, label);
    }
    for (const layerId of constraint.hide) {
      setIfAbsent(hiddenLayers, layerId, label);
    }
  });

  return { disabledTargets, requiredTargets, hiddenLayers, matchedConstraints };
}

/** True when the whole layer is disabled, or when this specific option is. */
export function isOptionDisabled(
  evaluation: RuleEvaluation,
  layerId: string,
  optionId: string,
): boolean {
  return (
    evaluation.disabledTargets.has(layerId) ||
    evaluation.disabledTargets.has(formatTargetRef(layerId, optionId))
  );
}

export function disablingConstraint(
  evaluation: RuleEvaluation,
  layerId: string,
  optionId: string,
): string | undefined {
  return (
    evaluation.disabledTargets.get(layerId) ??
    evaluation.disabledTargets.get(formatTargetRef(layerId, optionId))
  );
}

/** Constraints that the finished selection fails to satisfy. */
export function findViolations(
  evaluation: RuleEvaluation,
  selection: SelectionInput,
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const [layerId, optionId] of Object.entries(selection)) {
    if (optionId === undefined) {
      continue;
    }

    const constraint = disablingConstraint(evaluation, layerId, optionId);
    if (constraint !== undefined) {
      violations.push({
        constraint,
        message: `"${formatTargetRef(layerId, optionId)}" is disabled by ${constraint}`,
      });
    }
  }

  for (const [target, constraint] of evaluation.requiredTargets) {
    if (!isTargetSelected(target, selection)) {
      violations.push({
        constraint,
        message: `"${target}" is required by ${constraint} but is not selected`,
      });
    }
  }

  return violations;
}

function isTargetSelected(target: string, selection: SelectionInput): boolean {
  const { layerId, optionId } = parseTargetRef(target);
  const selected = selection[layerId];

  if (selected === undefined) {
    return false;
  }

  return optionId === undefined || selected === optionId;
}

function matches(constraint: Constraint, selection: SelectionInput): boolean {
  return Object.entries(constraint.when).every(([layerId, expected]) => {
    const selected = selection[layerId];
    if (selected === undefined) {
      return false;
    }

    return Array.isArray(expected)
      ? expected.includes(selected)
      : selected === expected;
  });
}

function constraintLabel(constraint: Constraint, index: number): string {
  return constraint.id ?? constraint.description ?? `constraints[${index}]`;
}

function setIfAbsent(
  target: Map<string, string>,
  key: string,
  value: string,
): void {
  if (!target.has(key)) {
    target.set(key, value);
  }
}
