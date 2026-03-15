import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { parsePackOptions } from './pack.ts';

describe('pack command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-pack-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('--help', () => {
    it('should display pack help message', () => {
      const result = runCli(['pack', '--help'], testDir);
      expect(result.stdout).toContain('skills pack <source>');
      expect(result.stdout).toContain('--output');
      expect(result.stdout).toContain('--skill');
      expect(result.stdout).toContain('--installed');
      expect(result.stdout).toContain('--list');
      expect(result.stdout).toContain('--yes');
      expect(result.stdout).toContain('--all');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('missing source', () => {
    it('should show error when no source provided', () => {
      const result = runCli(['pack'], testDir);
      expect(result.stdout).toContain('ERROR');
      expect(result.stdout).toContain('Missing required argument: source');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('local path', () => {
    it('should show error for non-existent local path', () => {
      const result = runCli(['pack', './non-existent-path', '-y'], testDir);
      expect(result.stdout).toContain('Path not found');
      expect(result.exitCode).toBe(1);
    });

    it('should list skills from local path with --list flag', () => {
      const skillDir = join(testDir, 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill for pack testing
---

# Test Skill

This is a test skill.
`
      );

      const result = runCli(['pack', testDir, '--list'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).toContain('A test skill for pack testing');
      expect(result.exitCode).toBe(0);
    });

    it('should show no skills found for empty directory', () => {
      const result = runCli(['pack', testDir, '-y'], testDir);
      expect(result.stdout).toContain('No skills found');
      expect(result.stdout).toContain('No valid skills found');
      expect(result.exitCode).toBe(1);
    });

    it('should pack skill from local path with -y flag', () => {
      const skillDir = join(testDir, 'skills', 'my-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: my-skill
description: My test skill
---

# My Skill

Instructions here.
`
      );

      const outputDir = join(testDir, 'output');
      mkdirSync(outputDir, { recursive: true });

      const result = runCli(
        ['pack', testDir, '--skill', 'my-skill', '-y', '-o', outputDir],
        testDir
      );
      expect(result.stdout).toContain('Packed');
      expect(result.exitCode).toBe(0);

      const skillFile = join(outputDir, 'my-skill.skill');
      expect(existsSync(skillFile)).toBe(true);
    });

    it('should list all skills with --list flag', () => {
      const skill1Dir = join(testDir, 'skills', 'skill-one');
      const skill2Dir = join(testDir, 'skills', 'skill-two');
      mkdirSync(skill1Dir, { recursive: true });
      mkdirSync(skill2Dir, { recursive: true });

      writeFileSync(
        join(skill1Dir, 'SKILL.md'),
        `---
name: skill-one
description: First skill
---
# Skill One
`
      );

      writeFileSync(
        join(skill2Dir, 'SKILL.md'),
        `---
name: skill-two
description: Second skill
---
# Skill Two
`
      );

      const result = runCli(['pack', testDir, '--list'], testDir);
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('Available Skills');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('validation errors', () => {
    it('should fail packing skill with missing description', () => {
      const skillDir = join(testDir, 'no-desc-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: no-desc-skill
---

# Skill`
      );

      const result = runCli(['pack', testDir, '-y'], testDir);
      expect(result.stdout).toContain('No valid skills found');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('--installed flag', () => {
    it('should list installed skills with --installed --list', () => {
      const result = runCli(['pack', '--installed', '--list'], testDir);
      expect(result.stdout).toContain('Installed Skills');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('aliases', () => {
    it('should support p alias for pack', () => {
      const result = runCli(['p'], testDir);
      expect(result.stdout).toContain('Missing required argument: source');
      expect(result.exitCode).toBe(1);
    });
  });
});

describe('parsePackOptions', () => {
  it('should parse --output flag', () => {
    const result = parsePackOptions(['source', '--output', '/tmp/output']);
    expect(result.source).toBe('source');
    expect(result.options.output).toBe('/tmp/output');
  });

  it('should parse -o shorthand', () => {
    const result = parsePackOptions(['source', '-o', '/tmp/output']);
    expect(result.source).toBe('source');
    expect(result.options.output).toBe('/tmp/output');
  });

  it('should parse --skill flag', () => {
    const result = parsePackOptions(['source', '--skill', 'my-skill']);
    expect(result.source).toBe('source');
    expect(result.options.skill).toEqual(['my-skill']);
  });

  it('should parse -s shorthand', () => {
    const result = parsePackOptions(['source', '-s', 'my-skill']);
    expect(result.source).toBe('source');
    expect(result.options.skill).toEqual(['my-skill']);
  });

  it('should parse multiple --skill flags', () => {
    const result = parsePackOptions(['source', '--skill', 'skill1', '--skill', 'skill2']);
    expect(result.source).toBe('source');
    expect(result.options.skill).toEqual(['skill1', 'skill2']);
  });

  it('should parse --yes flag', () => {
    const result = parsePackOptions(['source', '--yes']);
    expect(result.source).toBe('source');
    expect(result.options.yes).toBe(true);
  });

  it('should parse -y shorthand', () => {
    const result = parsePackOptions(['source', '-y']);
    expect(result.source).toBe('source');
    expect(result.options.yes).toBe(true);
  });

  it('should parse --all flag', () => {
    const result = parsePackOptions(['source', '--all']);
    expect(result.source).toBe('source');
    expect(result.options.all).toBe(true);
    expect(result.options.skill).toEqual(['*']);
    expect(result.options.yes).toBe(true);
  });

  it('should parse --list flag', () => {
    const result = parsePackOptions(['source', '--list']);
    expect(result.source).toBe('source');
    expect(result.options.list).toBe(true);
  });

  it('should parse -l shorthand', () => {
    const result = parsePackOptions(['source', '-l']);
    expect(result.source).toBe('source');
    expect(result.options.list).toBe(true);
  });

  it('should parse --installed flag', () => {
    const result = parsePackOptions(['--installed']);
    expect(result.source).toBe(null);
    expect(result.options.installed).toBe(true);
  });

  it('should parse combined flags', () => {
    const result = parsePackOptions(['source', '--skill', 'my-skill', '-y', '--output', '/tmp']);
    expect(result.source).toBe('source');
    expect(result.options.skill).toEqual(['my-skill']);
    expect(result.options.yes).toBe(true);
    expect(result.options.output).toBe('/tmp');
  });

  it('should handle no source', () => {
    const result = parsePackOptions([]);
    expect(result.source).toBe(null);
    expect(result.options).toEqual({});
  });

  it('should handle unknown flags gracefully', () => {
    const result = parsePackOptions(['source', '--unknown-flag', 'value']);
    expect(result.source).toBe('source');
  });
});
