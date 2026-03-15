import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateSkill } from './validation.ts';

describe('validateSkill', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-validation-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('SKILL.md existence', () => {
    it('should fail when SKILL.md does not exist', async () => {
      const result = await validateSkill(testDir);
      expect(result.valid).toBe(false);
      expect(result.message).toBe('SKILL.md not found');
      expect(result.errors).toContain('SKILL.md not found');
    });
  });

  describe('frontmatter validation', () => {
    it('should fail when no frontmatter present', async () => {
      writeFileSync(join(testDir, 'SKILL.md'), `# My Skill\n\nNo frontmatter here.`);

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(false);
      expect(result.message).toBe('No YAML frontmatter found');
    });

    it('should fail when frontmatter is malformed', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: [broken yaml
description: Test
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Invalid YAML');
    });
  });

  describe('required fields', () => {
    it('should fail when name is missing', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
description: A test skill
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing 'name' in frontmatter");
    });

    it('should fail when description is missing', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: my-skill
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing 'description' in frontmatter");
    });

    it('should pass with name and description', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: my-skill
description: A test skill
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(true);
    });
  });

  describe('name validation', () => {
    it('should accept valid kebab-case names', async () => {
      const validNames = ['my-skill', 'test', 'skill-123', 'a-b-c', 'my-awesome-skill', 'skill1'];

      for (const name of validNames) {
        const skillDir = join(testDir, name);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, 'SKILL.md'),
          `---
name: ${name}
description: A test skill
---

# Skill`
        );

        const result = await validateSkill(skillDir);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject names with invalid characters', async () => {
      const invalidNames = ['MySkill', 'my_skill', 'my skill', 'my.skill'];

      for (const name of invalidNames) {
        const skillDir = join(testDir, name.replace(/[^a-z0-9]/g, 'x'));
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, 'SKILL.md'),
          `---
name: ${name}
description: A test skill
---

# Skill`
        );

        const result = await validateSkill(skillDir);
        expect(result.valid).toBe(false);
        expect(result.message).toContain('kebab-case');
      }
    });

    it('should reject names starting or ending with hyphen', async () => {
      const skillDir = join(testDir, 'test-hyphen-start');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: -my-skill
description: A test skill
---

# Skill`
      );

      const result = await validateSkill(skillDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('cannot start or end with hyphen');
    });

    it('should reject names ending with hyphen', async () => {
      const skillDir = join(testDir, 'test-hyphen-end');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: my-skill-
description: A test skill
---

# Skill`
      );

      const result = await validateSkill(skillDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('cannot start or end with hyphen');
    });

    it('should reject names with consecutive hyphens', async () => {
      const skillDir = join(testDir, 'test-consecutive');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: my--skill
description: A test skill
---

# Skill`
      );

      const result = await validateSkill(skillDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('consecutive hyphens');
    });

    it('should reject names longer than 64 characters', async () => {
      const longName = 'a'.repeat(65);
      const skillDir = join(testDir, 'test-long-name');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: ${longName}
description: A test skill
---

# Skill`
      );

      const result = await validateSkill(skillDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('too long');
    });

    it('should accept names of exactly 64 characters', async () => {
      const validName = 'a'.repeat(64);
      const skillDir = join(testDir, 'test-exact-length');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: ${validName}
description: A test skill
---

# Skill`
      );

      const result = await validateSkill(skillDir);
      expect(result.valid).toBe(true);
    });
  });

  describe('description validation', () => {
    it('should reject descriptions with angle brackets', async () => {
      const skillDir = join(testDir, 'test-brackets');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A <test> description
---

# Skill`
      );

      const result = await validateSkill(skillDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('angle brackets');
    });

    it('should reject descriptions longer than 1024 characters', async () => {
      const longDesc = 'a'.repeat(1025);
      const skillDir = join(testDir, 'test-long-desc');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: ${longDesc}
---

# Skill`
      );

      const result = await validateSkill(skillDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('too long');
    });

    it('should accept descriptions of exactly 1024 characters', async () => {
      const validDesc = 'a'.repeat(1024);
      const skillDir = join(testDir, 'test-exact-desc');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: ${validDesc}
---

# Skill`
      );

      const result = await validateSkill(skillDir);
      expect(result.valid).toBe(true);
    });
  });

  describe('unexpected properties', () => {
    it('should reject unexpected properties in frontmatter', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: my-skill
description: A test skill
invalid-property: something
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Unexpected key');
    });

    it('should accept allowed properties', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: my-skill
description: A test skill
license: MIT
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(true);
    });

    it('should accept allowed-tools property', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: my-skill
description: A test skill
allowed-tools:
  - tool1
  - tool2
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(true);
    });

    it('should accept metadata property', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: my-skill
description: A test skill
metadata:
  internal: true
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(true);
    });

    it('should accept compatibility property', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: my-skill
description: A test skill
compatibility: claude-code >= 1.0.0
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(true);
    });
  });

  describe('type validation', () => {
    it('should reject non-string name', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name:
  - array
  - value
description: A test skill
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Name must be a string');
    });

    it('should reject non-string description', async () => {
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: my-skill
description:
  - list
  - of
  - items
---

# My Skill`
      );

      const result = await validateSkill(testDir);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Description must be a string');
    });
  });
});
