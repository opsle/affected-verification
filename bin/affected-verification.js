#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  InputError,
  buildValueReceipt,
  canonicalJson,
  classifyShadow,
  operatorIndicator,
  planVerification,
} from '../src/index.js';
import { scenarios } from '../fixtures/scenarios.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseReceipt(args) {
  const index = args.indexOf('--receipt');
  if (index === -1) return null;
  if (!args[index + 1]) throw new InputError(['--receipt requires a path']);
  return args[index + 1];
}

function loadFixture(id) {
  const fixture = scenarios.find((item) => item.id === id);
  if (!fixture) throw new InputError([`unknown fixture ${id}`]);
  return fixture.input;
}

function usage() {
  return [
    'affected-verification plan <input.json> [--receipt <receipt.json>]',
    'affected-verification fixture <id> [--receipt <receipt.json>]',
    'affected-verification shadow <plan.json> <full-run.json>',
  ].join('\n');
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || !command) {
    process.stdout.write(`${usage()}\n`);
  } else if (command === 'plan' || command === 'fixture') {
    if (!args[0]) throw new InputError([`${command} requires an input`]);
    const input = command === 'plan' ? readJson(args[0]) : loadFixture(args[0]);
    const plan = planVerification(input);
    const receiptPath = parseReceipt(args);
    if (receiptPath) writeFileSync(receiptPath, `${canonicalJson(buildValueReceipt(plan))}\n`);
    process.stdout.write(`${canonicalJson(plan)}\n`);
    process.stderr.write(`${operatorIndicator(plan)}\n`);
  } else if (command === 'shadow') {
    if (!args[0] || !args[1]) throw new InputError(['shadow requires a plan and full-run input']);
    process.stdout.write(`${canonicalJson(classifyShadow(readJson(args[0]), readJson(args[1])))}\n`);
  } else {
    throw new InputError([`unknown command ${command}`]);
  }
} catch (error) {
  if (error instanceof InputError || error instanceof SyntaxError) {
    const packet = {
      schema: 'opsle.affected-verification.error.v1',
      code: error.code ?? 'INVALID_JSON',
      issues: error.issues ?? [error.message],
    };
    process.stdout.write(`${canonicalJson(packet)}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
