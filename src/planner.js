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

function dependencyArgument(assessment, action, forced) {
  const boundaries = [...assessment.boundaries]
    .map((item) => ({ ...item, evidence_refs: sortedUnique(item.evidence_refs) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const mechanisms = [...assessment.mechanisms]
    .map((item) => ({ ...item, evidence_refs: sortedUnique(item.evidence_refs) }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
  const openKinds = boundaries
    .filter((item) => item.relevant && item.status === 'OPEN')
    .map((item) => item.kind);
  const unresolved = openKinds.length
    ? openKinds
    : ['INCOMPLETE', 'UNKNOWN'].includes(assessment.completeness)
      ? ['UNDECLARED_OR_INCOMPLETE']
      : [];
  return {
    state: assessment.completeness,
    mechanisms,
    boundaries,
    evidence_coverage: sortedUnique([
      ...mechanisms.flatMap((item) => item.evidence_refs),
      ...boundaries.flatMap((item) => item.evidence_refs),
    ]),
    unresolved_mechanisms: sortedUnique(unresolved),
    explanation: assessment.explanation,
    action,
    forced_selection: forced,
  };
}

function mapCheck(check, reasons, assessment, action, forced = false) {
  return {
    id: check.id,
    type: check.type,
    command: check.command,
    scope: { components: [...check.scope.components].sort() },
    tags: [...check.tags].sort(),
    test_executions: check.test_executions,
    reasons,
    dependency_completeness: dependencyArgument(assessment, action, forced),
  };
}

function dependencyForcesSelection(assessment) {
  return ['INCOMPLETE', 'OPAQUE_BOUNDARY', 'UNKNOWN'].includes(assessment.completeness)
    || assessment.mechanisms.some((item) => item.positive);
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
  const checkDependencies = new Map(
    input.evidence.check_dependencies.map((item) => [item.check_id, item]),
  );
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
  const dependencyForcedChecks = [];
  for (const check of [...input.catalog.checks].sort((a, b) => a.id.localeCompare(b.id))) {
    const dependency = checkDependencies.get(check.id);
    const requiredBy = requiredTagsByRule.filter((rule) => check.tags.some((tag) => rule.tags.has(tag)));
    const scopeIntersects = check.scope.components.some((component) => component === '*' || affectedIds.has(component));
    const dependencyForced = dependencyForcesSelection(dependency);
    if (selectAll || scopeIntersects || requiredBy.length || dependencyForced) {
      const reasons = selectionReason(check, affectedIds, requiredBy);
      if (dependency.mechanisms.some((item) => item.positive)) {
        reasons.push(reason(
          'POSITIVE_DEPENDENCY_EVIDENCE',
          'At least one identified evidence source positively selected this check',
          dependency.mechanisms.filter((item) => item.positive).flatMap((item) => item.evidence_refs),
        ));
      }
      if (['INCOMPLETE', 'OPAQUE_BOUNDARY', 'UNKNOWN'].includes(dependency.completeness)) {
        reasons.push(reason(
          dependency.completeness === 'OPAQUE_BOUNDARY'
            ? 'OPAQUE_BOUNDARY_FORCED_SELECTION'
            : 'DEPENDENCY_COMPLETENESS_FORCED_SELECTION',
          `Skip sufficiency cannot be defended: dependency completeness is ${dependency.completeness}`,
          [
            ...dependency.mechanisms.flatMap((item) => item.evidence_refs),
            ...dependency.boundaries.flatMap((item) => item.evidence_refs),
          ],
        ));
      }
      if (selectAll) {
        reasons.push(reason(
          uncertaintyReasons.length ? 'FAIL_CLOSED_FULL_SELECTION' : 'POLICY_REQUIRES_FULL_SELECTION',
          uncertaintyReasons.length
            ? 'All catalogued checks selected because targeted sufficiency cannot be defended'
            : 'All catalogued checks selected by matched policy',
          uncertaintyReasons.length ? ['impact-evidence', 'verification-catalog'] : policies.map((rule) => `policy-rule:${rule.id}`),
        ));
      }
      const forced = dependencyForced && !selectAll && !scopeIntersects && requiredBy.length === 0;
      if (forced) dependencyForcedChecks.push(check.id);
      selected.push(mapCheck(check, reasons, dependency, 'SELECT', forced));
    } else {
      skipped.push(mapCheck(check, [
        reason(
          'OUTSIDE_TRANSITIVE_IMPACT_SET',
          'Check scope does not intersect the direct or reverse-dependent impact set and no matched policy requires it',
          ['impact-evidence', 'verification-catalog', 'verification-policy'],
        ),
        reason(
          'CHECK_DEPENDENCY_COMPLETENESS_DEFENDED',
          `Check-level dependency evidence is ${dependency.completeness}; no unresolved relevant boundary remains`,
          [
            ...dependency.mechanisms.flatMap((item) => item.evidence_refs),
            ...dependency.boundaries.flatMap((item) => item.evidence_refs),
            'verification-policy',
          ],
        ),
      ], dependency, 'SKIP'));
    }
  }

  const escalationState = selectAll
    ? 'FULL'
    : maxEscalation === 'BROADEN' || dependencyForcedChecks.length
      ? 'BROADENED'
      : 'NONE';
  if (dependencyForcedChecks.length && sufficiency === 'SUFFICIENT_TARGETED') {
    sufficiency = 'SUFFICIENT_BROADENED';
  }
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
    dependency_completeness: {
      checks_assessed: input.evidence.check_dependencies.length,
      forced_check_ids: sortedUnique(dependencyForcedChecks),
      states: Object.fromEntries(
        [...new Set(input.evidence.check_dependencies.map((item) => item.completeness))]
          .sort()
          .map((state) => [
            state,
            input.evidence.check_dependencies.filter((item) => item.completeness === state).length,
          ]),
      ),
      agreement_implies_completeness: false,
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
      reasons: [
        ...policies.filter((rule) => rule.escalation !== 'NONE').map((rule) => ({
          source: `policy-rule:${rule.id}`,
          escalation: rule.escalation,
        })),
        ...dependencyForcedChecks.map((checkId) => ({
          source: `check-dependency:${checkId}`,
          escalation: 'BROADEN',
        })),
      ],
    },
    sufficiency,
    argument: {
      claim: sufficiency === 'SUFFICIENT_TARGETED' || sufficiency === 'SUFFICIENT_BROADENED'
        ? 'Smallest set justified by the normalized evidence model and configured policy; no global mathematical minimality claim.'
        : 'Targeted sufficiency is not claimed.',
      unknown_is_safe_to_skip: false,
      every_skip_explained: skipped.every((check) => check.reasons.length > 0),
      every_skip_dependency_complete: skipped.every((check) =>
        ['COMPLETE_FOR_CHECK', 'COMPLETE_WITH_DECLARED_BOUNDARIES']
          .includes(check.dependency_completeness.state)),
    },
  };
  const planIdentity = contentIdentity({ ...planWithoutIdentity, plan_identity: undefined });
  return deepFreeze({ ...planWithoutIdentity, plan_identity: planIdentity });
}
