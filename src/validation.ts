import { readFile } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';

export interface ValidationResult {
  valid: boolean;
  message: string;
  errors: string[];
}

const ALLOWED_PROPERTIES = [
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
];

const KEBAB_CASE_REGEX = /^[a-z0-9-]+$/;

export async function validateSkill(skillPath: string): Promise<ValidationResult> {
  const errors: string[] = [];

  const skillMdPath = join(skillPath, 'SKILL.md');

  let content: string;
  try {
    content = await readFile(skillMdPath, 'utf-8');
  } catch {
    return {
      valid: false,
      message: 'SKILL.md not found',
      errors: ['SKILL.md not found'],
    };
  }

  if (!content.startsWith('---')) {
    errors.push('No YAML frontmatter found');
    return {
      valid: false,
      message: 'No YAML frontmatter found',
      errors,
    };
  }

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    errors.push('Invalid frontmatter format');
    return {
      valid: false,
      message: 'Invalid frontmatter format',
      errors,
    };
  }

  const frontmatterText = match[1]!;

  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = matter(content).data as Record<string, unknown>;
    if (typeof frontmatter !== 'object' || frontmatter === null) {
      errors.push('Frontmatter must be a YAML dictionary');
      return {
        valid: false,
        message: 'Frontmatter must be a YAML dictionary',
        errors,
      };
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown error';
    errors.push(`Invalid YAML in frontmatter: ${errMsg}`);
    return {
      valid: false,
      message: `Invalid YAML in frontmatter: ${errMsg}`,
      errors,
    };
  }

  const unexpectedKeys = Object.keys(frontmatter).filter(
    (key) => !ALLOWED_PROPERTIES.includes(key)
  );
  if (unexpectedKeys.length > 0) {
    const sorted = unexpectedKeys.sort();
    errors.push(
      `Unexpected key(s) in SKILL.md frontmatter: ${sorted.join(', ')}. Allowed properties are: ${ALLOWED_PROPERTIES.sort().join(', ')}`
    );
  }

  if (!('name' in frontmatter)) {
    errors.push("Missing 'name' in frontmatter");
  }
  if (!('description' in frontmatter)) {
    errors.push("Missing 'description' in frontmatter");
  }

  if (errors.length > 0) {
    return {
      valid: false,
      message: errors[0]!,
      errors,
    };
  }

  const name = frontmatter['name'];
  if (typeof name !== 'string') {
    errors.push(`Name must be a string, got ${typeof name}`);
  } else {
    const trimmedName = name.trim();
    if (trimmedName) {
      if (!KEBAB_CASE_REGEX.test(trimmedName)) {
        errors.push(
          `Name '${trimmedName}' should be kebab-case (lowercase letters, digits, and hyphens only)`
        );
      }
      if (trimmedName.startsWith('-') || trimmedName.endsWith('-')) {
        errors.push(`Name '${trimmedName}' cannot start or end with hyphen`);
      }
      if (trimmedName.includes('--')) {
        errors.push(`Name '${trimmedName}' cannot contain consecutive hyphens`);
      }
      if (trimmedName.length > 64) {
        errors.push(
          `Name is too long (${trimmedName.length} characters). Maximum is 64 characters.`
        );
      }
    }
  }

  const description = frontmatter['description'];
  if (typeof description !== 'string') {
    errors.push(`Description must be a string, got ${typeof description}`);
  } else {
    const trimmedDesc = description.trim();
    if (trimmedDesc) {
      if (trimmedDesc.includes('<') || trimmedDesc.includes('>')) {
        errors.push('Description cannot contain angle brackets (< or >)');
      }
      if (trimmedDesc.length > 1024) {
        errors.push(
          `Description is too long (${trimmedDesc.length} characters). Maximum is 1024 characters.`
        );
      }
    }
  }

  const compatibility = frontmatter['compatibility'];
  if (compatibility !== undefined) {
    if (typeof compatibility !== 'string') {
      errors.push(`Compatibility must be a string, got ${typeof compatibility}`);
    } else if (compatibility.length > 500) {
      errors.push(
        `Compatibility is too long (${compatibility.length} characters). Maximum is 500 characters.`
      );
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      message: errors[0]!,
      errors,
    };
  }

  return {
    valid: true,
    message: 'Skill is valid!',
    errors: [],
  };
}
