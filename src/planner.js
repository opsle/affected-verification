import { canonicalJson, contentIdentity, deepFreeze } from './canonical.js';
import { InputError, PLAN_SCHEMA, validateInput } from './validate.js';

const ESCALATION_ORDER = { NONE: 0, BROADEN: 1, FULL: 2, INVALIDATE: 3 };

function globMatches(pattern, path) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`).test(path);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function reason(code, detail, evidenceRefs) {
  return { code, detail, evidence_refs: sortedUnique(evidenceRefs) };
}

function directComponents(input) {
  return sortedUnique(input.evidence.impacts
    .filter((impact) => impact.confidence === 'KNOWN')
    .flatMap((impact) => impact.components));
}

function reverseClosure(components, direct) {
  const affected = new Set(direct);
  const via = new Map(direct.map((id) => [id, []]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of components) {
      if (affected.has(component.id)) continue;
      const triggering = component.dependencies.filter((dependency) => affected.has(dependency)).sort();
      if (triggering.length) {
        affected.add(component.id);
        via.set(component.id, triggering);
        changed = true;
      }
    }
  }
  return [...affected].sort().map((id) => ({
    id,
    direct: direct.includes(id),
    via_dependencies: via.get(id) ?? [],
  }));
}

function matchedRules(input, affectedIds) {
  const changedPaths = input.change.paths.map((item) => item.path);
  const riskTags = new Set(input.change.paths.flatMap((item) => item.risk_tags ?? []));
  return input.policy.rules.filter((rule) => {
    const groups = [
      [rule.match.path_globs ?? [], (glob) => changedPaths.some((path) => globMatches(glob, path))],
      [rule.match.risk_tags ?? [], (tag) => riskTags.has(tag)],
      [rule.match.component_ids ?? [], (id) => affectedIds.has(id)],
    ];
    return groups.every(([values, matches]) => values.length === 0 || values.some(matches));
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function selectionReason(check, affectedIds, requiredBy) {
  const intersection = check.scope.components.filter((component) => component === '*' || affectedIds.has(component)).sort();
  const reasons = [];
  if (intersection.length) {
    reasons.push(reason(
      'SCOPE_INTERSECTS_AFFECTED_COMPONENT',
      `Check scope intersects: ${intersection.join(', ')}`,
      ['impact-evidence', 'verification-catalog'],
    ));
  }
  for (const rule of requiredBy) {
    reasons.push(reason(
      'REQUIRED_BY_POLICY',
      `Policy rule ${rule.id} requires one of this check's tags`,
      [`policy-rule:${rule.id}`, 'verification-catalog'],
    ));
  }
  return reasons;
}

function mapCheck(check, reasons) {
  return {
    id: check.id,
    type: check.type,
    command: check.command,
    scope: { components: [...check.scope.components].sort() },
    tags: [...check.tags].sort(),
    test_executions: check.test_executions,
    reasons,
  };
}

function uncertainty(input, affected) {
  const reasons = [];
  const impacts = new Map(input.evidence.impacts.map((item) => [item.path, item]));
  if (!input.evidence.complete) reasons.push('DEPENDENCY_EVIDENCE_INCOMPLETE');
  if (!input.catalog.complete) reasons.push('VERIFICATION_CATALOG_INCOMPLETE');
  for (const changed of input.change.paths) {
    const impact = impacts.get(changed.path);
    if (!impact) reasons.push(`NO_IMPACT_EVIDENCE:${changed.path}`);
    else if (impact.confidence === 'UNKNOWN') reasons.push(`UNKNOWN_IMPACT:${changed.path}`);
  }
  const covered = new Set();
  for (const check of input.catalog.checks) {
    for (const component of check.scope.components) covered.add(component);
  }
  if (!covered.has('*')) {
    for (const item of affected) {
      if (!covered.has(item.id)) reasons.push(`NO_VERIFICATION_COVERAGE:${item.id}`);
    }
  }
  return sortedUnique(reasons);
}

export function planVerification(rawInput) {
  const input = validateInput(rawInput);
  const inputHash = contentIdentity(input);
  const changeIdentity = input.change.identity ?? contentIdentity({
    base_revision: input.change.base_revision,
    paths: input.change.paths,
    target_revision: input.change.target_revision,
  });
  const direct = directComponents(input);
  const affected = reverseClosure(input.evidence.components, direct);
  const affectedIds = new Set(affected.map((item) => item.id));
  const policies = matchedRules(input, affectedIds);
  const maxEscalation = policies.reduce(
    (current, rule) => ESCALATION_ORDER[rule.escalation] > ESCALATION_ORDER[current]
      ? rule.escalation
      : current,
    'NONE',
  );
  if (maxEscalation === 'INVALIDATE') {
    throw new InputError(
      policies.filter((rule) => rule.escalation === 'INVALIDATE').map((rule) => `policy rule ${rule.id} invalidates planning`),
      'PLAN_INVALIDATED',
    );
  }

  let uncertaintyReasons = uncertainty(input, affected);
  for (const rule of policies) {
    for (const tag of rule.required_check_tags) {
      if (!input.catalog.checks.some((check) => check.tags.includes(tag))) {
        uncertaintyReasons.push(`POLICY_REQUIREMENT_UNSATISFIED:${rule.id}:${tag}`);
      }
    }
  }
  uncertaintyReasons = sortedUnique(uncertaintyReasons);
  const requiredTagsByRule = policies.map((rule) => ({
    ...rule,
    tags: new Set(rule.required_check_tags),
  }));
  let selectAll = maxEscalation === 'FULL';
  let sufficiency = maxEscalation === 'BROADEN'
    ? 'SUFFICIENT_BROADENED'
    : 'SUFFICIENT_TARGETED';
  if (uncertaintyReasons.length) {
    selectAll = true;
    const cannotBeRepairedByFullSelection = uncertaintyReasons.some((item) =>
      item.startsWith('NO_VERIFICATION_COVERAGE:')
      || item.startsWith('POLICY_REQUIREMENT_UNSATISFIED:'),
    );
    sufficiency = input.catalog.complete && !cannotBeRepairedByFullSelection
      ? 'FULL_VERIFICATION_REQUIRED'
      : 'INSUFFICIENT_EVIDENCE';
  } else if (selectAll) {
    sufficiency = 'FULL_VERIFICATION_REQUIRED';
  }

  const selected = [];
  const skipped = [];
  for (const check of [...input.catalog.checks].sort((a, b) => a.id.localeCompare(b.id))) {
    const requiredBy = requiredTagsByRule.filter((rule) => check.tags.some((tag) => rule.tags.has(tag)));
    const scopeIntersects = check.scope.components.some((component) => component === '*' || affectedIds.has(component));
    if (selectAll || scopeIntersects || requiredBy.length) {
      const reasons = selectionReason(check, affectedIds, requiredBy);
      if (selectAll) {
        reasons.push(reason(
          uncertaintyReasons.length ? 'FAIL_CLOSED_FULL_SELECTION' : 'POLICY_REQUIRES_FULL_SELECTION',
          uncertaintyReasons.length
            ? 'All catalogued checks selected because targeted sufficiency cannot be defended'
            : 'All catalogued checks selected by matched policy',
          uncertaintyReasons.length ? ['impact-evidence', 'verification-catalog'] : policies.map((rule) => `policy-rule:${rule.id}`),
        ));
      }
      selected.push(mapCheck(check, reasons));
    } else {
      skipped.push(mapCheck(check, [reason(
        'OUTSIDE_TRANSITIVE_IMPACT_SET',
        'Check scope does not intersect the direct or reverse-dependent impact set and no matched policy requires it',
        ['impact-evidence', 'verification-catalog', 'verification-policy'],
      )]));
    }
  }

  const escalationState = selectAll
    ? 'FULL'
    : maxEscalation === 'BROADEN'
      ? 'BROADENED'
      : 'NONE';
  const planWithoutIdentity = {
    schema: PLAN_SCHEMA,
    plan_identity: null,
    change: {
      base_revision: input.change.base_revision,
      target_revision: input.change.target_revision,
      identity: changeIdentity,
      changed_paths: input.change.paths.map((item) => item.path).sort(),
      changed_regions: input.change.paths
        .flatMap((item) => item.regions.map((region) => ({ path: item.path, region })))
        .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    },
    provenance: {
      input_hash: inputHash,
      evidence_identity: input.evidence.identity,
      verification_catalog_identity: input.catalog.identity,
      policy_identity: input.policy.identity,
      policy_version: input.policy.version,
      providers: [...input.evidence.providers]
        .map((provider) => ({ ...provider }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
    affected_components: affected,
    selected_checks: selected,
    skipped_checks: skipped,
    risk: {
      classification: maxEscalation === 'FULL'
        ? 'POLICY_FULL'
        : maxEscalation === 'BROADEN'
          ? 'POLICY_BROADENED'
          : input.change.paths.some((item) => item.risk_tags.length)
            ? 'DECLARED_TAGGED'
            : 'BASELINE',
      tags: sortedUnique(input.change.paths.flatMap((item) => item.risk_tags)),
      matched_policy_rules: policies.map((rule) => rule.id),
    },
    uncertainty: {
      state: uncertaintyReasons.length ? 'PRESENT' : 'NONE',
      reasons: uncertaintyReasons,
    },
    escalation: {
      state: escalationState,
      reasons: policies.filter((rule) => rule.escalation !== 'NONE').map((rule) => ({
        rule_id: rule.id,
        escalation: rule.escalation,
      })),
    },
    sufficiency,
    argument: {
      claim: sufficiency === 'SUFFICIENT_TARGETED' || sufficiency === 'SUFFICIENT_BROADENED'
        ? 'Smallest set justified by the normalized evidence model and configured policy; no global mathematical minimality claim.'
        : 'Targeted sufficiency is not claimed.',
      unknown_is_safe_to_skip: false,
      every_skip_explained: skipped.every((check) => check.reasons.length > 0),
    },
  };
  const planIdentity = contentIdentity({ ...planWithoutIdentity, plan_identity: undefined });
  return deepFreeze({ ...planWithoutIdentity, plan_identity: planIdentity });
}
