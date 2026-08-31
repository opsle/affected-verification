function source(line, construct) {
  return { path: 'checks/example.py', line, construct };
}

function boundary(id, kind, status = 'OPEN', relevant = true) {
  return {
    id,
    kind,
    status,
    relevant,
    explanation: `${kind} fixture boundary is ${status}.`,
    evidence_refs: ['boundary-inspector'],
    source: source(Number(id.replace(/\D/g, '')) || 1, kind.toLowerCase()),
  };
}

function assessment(checkId, {
  completeness = 'COMPLETE_FOR_CHECK',
  kind = 'DECLARED_SCOPE',
  boundaries = [],
  nativePositive = false,
} = {}) {
  const mechanisms = [
    { kind, evidence_refs: ['boundary-inspector'], positive: false },
  ];
  if (nativePositive) {
    mechanisms.push({ kind: 'NATIVE_SELECTOR', evidence_refs: ['native-selector'], positive: true });
  }
  return {
    check_id: checkId,
    completeness,
    mechanisms,
    boundaries,
    explanation: `Fixture assessment is ${completeness}.`,
  };
}

function makeInput(options = {}) {
  const checks = [
    { id: 'changed.unit', type: 'unit-test', command: 'pytest changed', scope: { components: ['changed'] }, tags: ['direct'], test_executions: 3 },
    { id: 'boundary.observe', type: 'unit-test', command: 'pytest boundary', scope: { components: ['boundary'] }, tags: ['boundary'], test_executions: 1 },
    { id: 'unrelated.unit', type: 'unit-test', command: 'pytest unrelated', scope: { components: ['unrelated'] }, tags: ['unrelated'], test_executions: 5 },
  ];
  const providers = [
    { id: 'boundary-inspector', kind: 'DETERMINISTIC_CHECK_BOUNDARY_METADATA', version: '1', identity: 'sha256:boundary-inspector' },
    { id: 'native-selector', kind: 'NATIVE_SELECTOR', version: '1', identity: 'sha256:native-selector' },
  ];
  return {
    schema: 'opsle.affected-verification.input.v2',
    change: {
      base_revision: 'base',
      target_revision: options.target ?? 'target',
      paths: [{ path: options.changedPath ?? 'src/changed.py', regions: [], risk_tags: [] }],
    },
    evidence: {
      identity: 'sha256:opaque-fixture',
      complete: true,
      providers,
      components: [
        { id: 'changed', dependencies: [] },
        { id: 'boundary', dependencies: [] },
        { id: 'unrelated', dependencies: [] },
      ],
      impacts: [{ path: options.changedPath ?? 'src/changed.py', components: ['changed'], confidence: 'KNOWN', reason: 'fixture ownership' }],
      check_dependencies: [
        assessment('changed.unit'),
        assessment('boundary.observe', options.boundaryAssessment),
        assessment('unrelated.unit'),
      ],
    },
    catalog: { identity: 'sha256:opaque-catalog', complete: true, checks },
    policy: { identity: 'sha256:opaque-policy', version: '1', rules: [] },
  };
}

export const opaqueBoundaryScenarios = [
  {
    id: 'AV3-001',
    input: makeInput({ boundaryAssessment: { completeness: 'OPAQUE_BOUNDARY', kind: 'SUBPROCESS', boundaries: [boundary('b1', 'SUBPROCESS')] } }),
    oracle_relevant: ['changed.unit', 'boundary.observe'],
    expected_selected: ['boundary.observe', 'changed.unit'],
  },
  {
    id: 'AV3-002',
    input: makeInput({ boundaryAssessment: { completeness: 'OPAQUE_BOUNDARY', kind: 'DYNAMIC_IMPORT', boundaries: [boundary('b2', 'DYNAMIC_IMPORT')] } }),
    oracle_relevant: ['changed.unit', 'boundary.observe'],
    expected_selected: ['boundary.observe', 'changed.unit'],
  },
  {
    id: 'AV3-003',
    input: makeInput({ boundaryAssessment: { completeness: 'OPAQUE_BOUNDARY', kind: 'PLUGIN_OR_ENTRY_POINT_DISCOVERY', boundaries: [boundary('b3', 'PLUGIN_OR_ENTRY_POINT_DISCOVERY')] } }),
    oracle_relevant: ['changed.unit', 'boundary.observe'],
    expected_selected: ['boundary.observe', 'changed.unit'],
  },
  {
    id: 'AV3-004',
    input: makeInput(),
    oracle_relevant: ['changed.unit'],
    expected_selected: ['changed.unit'],
  },
  {
    id: 'AV3-005',
    input: makeInput({ boundaryAssessment: { completeness: 'COMPLETE_FOR_CHECK', kind: 'SUBPROCESS', boundaries: [boundary('b5', 'SUBPROCESS', 'IRRELEVANT', false)] } }),
    oracle_relevant: ['changed.unit'],
    expected_selected: ['changed.unit'],
  },
  {
    id: 'AV3-006',
    input: makeInput({ boundaryAssessment: { completeness: 'UNKNOWN' } }),
    oracle_relevant: ['changed.unit', 'boundary.observe'],
    expected_selected: ['boundary.observe', 'changed.unit'],
  },
  {
    id: 'AV3-007',
    input: makeInput({ boundaryAssessment: { completeness: 'OPAQUE_BOUNDARY', kind: 'CHILD_INTERPRETER', boundaries: [boundary('b7', 'CHILD_INTERPRETER')] } }),
    oracle_relevant: ['changed.unit', 'boundary.observe'],
    expected_selected: ['boundary.observe', 'changed.unit'],
    native_selected: [],
  },
  {
    id: 'AV3-008',
    input: makeInput({ boundaryAssessment: { completeness: 'INCOMPLETE', nativePositive: true } }),
    oracle_relevant: ['changed.unit', 'boundary.observe'],
    expected_selected: ['boundary.observe', 'changed.unit'],
    native_selected: ['boundary.observe'],
  },
  {
    id: 'AV3-009',
    input: makeInput({ boundaryAssessment: { completeness: 'OPAQUE_BOUNDARY', kind: 'EXEC_EVAL_OR_CODE_GENERATION', boundaries: [boundary('b9', 'EXEC_EVAL_OR_CODE_GENERATION')] } }),
    oracle_relevant: ['changed.unit', 'boundary.observe'],
    expected_selected: ['boundary.observe', 'changed.unit'],
  },
  {
    id: 'AV3-010',
    input: makeInput({ boundaryAssessment: { completeness: 'COMPLETE_WITH_DECLARED_BOUNDARIES', kind: 'DYNAMIC_IMPORT', boundaries: [boundary('b10', 'DYNAMIC_IMPORT', 'CLOSED', true)] } }),
    oracle_relevant: ['changed.unit'],
    expected_selected: ['changed.unit'],
  },
];

export function opaqueFixture(id) {
  return structuredClone(opaqueBoundaryScenarios.find((item) => item.id === id)?.input);
}
