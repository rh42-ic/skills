import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink, lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

async function makeSkillDir(root: string, name: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---
name: ${name}
description: Test skill for symlink handling
---

# ${name}

Test skill content.
`,
    'utf-8'
  );
  return dir;
}

describe('pack symlink handling', () => {
  let testDir: string;
  let outputDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'pack-symlink-test-'));
    outputDir = join(testDir, 'output');
    await mkdir(outputDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('dereferences symlink pointing to file', async () => {
    const skillDir = await makeSkillDir(testDir, 'file-symlink-skill');
    const targetFile = join(testDir, 'target-file.txt');
    await writeFile(targetFile, 'This is the target file content', 'utf-8');

    const linkPath = join(skillDir, 'linked-file.txt');
    await symlink(targetFile, linkPath);

    const result = execSync(
      `node ${join(process.cwd(), 'src', 'cli.ts')} pack ${testDir} --skill file-symlink-skill -y -o ${outputDir}`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    expect(result).toContain('Packed');

    const skillFile = join(outputDir, 'file-symlink-skill.skill');
    expect(existsSync(skillFile)).toBe(true);

    const listing = execSync(`unzip -l ${skillFile}`, { encoding: 'utf-8' });
    expect(listing).toContain('linked-file.txt');

    const extractedDir = join(testDir, 'extracted-file');
    execSync(`unzip -o ${skillFile} -d ${extractedDir}`, { encoding: 'utf-8' });

    const extractedContent = await readFile(
      join(extractedDir, 'file-symlink-skill', 'linked-file.txt'),
      'utf-8'
    );
    expect(extractedContent).toBe('This is the target file content');
  });

  it('dereferences symlink pointing to directory', async () => {
    const skillDir = await makeSkillDir(testDir, 'dir-symlink-skill');
    const targetDir = join(testDir, 'target-dir');
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, 'file1.txt'), 'File 1 content', 'utf-8');
    await writeFile(join(targetDir, 'file2.txt'), 'File 2 content', 'utf-8');

    const linkPath = join(skillDir, 'linked-dir');
    await symlink(targetDir, linkPath);

    const result = execSync(
      `node ${join(process.cwd(), 'src', 'cli.ts')} pack ${testDir} --skill dir-symlink-skill -y -o ${outputDir}`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    expect(result).toContain('Packed');

    const skillFile = join(outputDir, 'dir-symlink-skill.skill');
    expect(existsSync(skillFile)).toBe(true);

    const listing = execSync(`unzip -l ${skillFile}`, { encoding: 'utf-8' });
    expect(listing).toContain('linked-dir/file1.txt');
    expect(listing).toContain('linked-dir/file2.txt');

    const extractedDir = join(testDir, 'extracted-dir');
    execSync(`unzip -o ${skillFile} -d ${extractedDir}`, { encoding: 'utf-8' });

    const file1 = await readFile(
      join(extractedDir, 'dir-symlink-skill', 'linked-dir', 'file1.txt'),
      'utf-8'
    );
    const file2 = await readFile(
      join(extractedDir, 'dir-symlink-skill', 'linked-dir', 'file2.txt'),
      'utf-8'
    );
    expect(file1).toBe('File 1 content');
    expect(file2).toBe('File 2 content');
  });

  it('skips broken symlink with warning', async () => {
    const skillDir = await makeSkillDir(testDir, 'broken-symlink-skill');

    const nonexistentTarget = join(testDir, 'nonexistent-file.txt');
    const linkPath = join(skillDir, 'broken-link.txt');
    await symlink(nonexistentTarget, linkPath);

    const result = execSync(
      `node ${join(process.cwd(), 'src', 'cli.ts')} pack ${testDir} --skill broken-symlink-skill -y -o ${outputDir} 2>&1`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    expect(result).toContain('Skipping broken symlink');
    expect(result).toContain('Packed');

    const skillFile = join(outputDir, 'broken-symlink-skill.skill');
    expect(existsSync(skillFile)).toBe(true);

    const listing = execSync(`unzip -l ${skillFile}`, { encoding: 'utf-8' });
    expect(listing).not.toContain('broken-link.txt');
  });

  it('skips circular symlink with warning', async () => {
    const skillDir = await makeSkillDir(testDir, 'circular-symlink-skill');
    const nestedDir = join(skillDir, 'nested');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, 'file.txt'), 'Nested file', 'utf-8');

    const linkPath = join(nestedDir, 'circular');
    await symlink(skillDir, linkPath);

    const result = execSync(
      `node ${join(process.cwd(), 'src', 'cli.ts')} pack ${testDir} --skill circular-symlink-skill -y -o ${outputDir} 2>&1`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    expect(result).toContain('Skipping circular symlink');
    expect(result).toContain('Packed');

    const skillFile = join(outputDir, 'circular-symlink-skill.skill');
    expect(existsSync(skillFile)).toBe(true);

    const listing = execSync(`unzip -l ${skillFile}`, { encoding: 'utf-8' });
    expect(listing).toContain('nested/file.txt');
    expect(listing).not.toContain('nested/circular');
  });

  it('handles nested symlinks', async () => {
    const skillDir = await makeSkillDir(testDir, 'nested-symlink-skill');

    const dir1 = join(testDir, 'dir1');
    const dir2 = join(testDir, 'dir2');
    const dir3 = join(testDir, 'dir3');
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await mkdir(dir3, { recursive: true });

    await writeFile(join(dir3, 'deepest.txt'), 'Content in dir3', 'utf-8');

    const link2 = join(dir1, 'link-to-dir2');
    await symlink(dir2, link2);

    const link3 = join(dir2, 'link-to-dir3');
    await symlink(dir3, link3);

    const linkInSkill = join(skillDir, 'entry');
    await symlink(dir1, linkInSkill);

    const result = execSync(
      `node ${join(process.cwd(), 'src', 'cli.ts')} pack ${testDir} --skill nested-symlink-skill -y -o ${outputDir}`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    expect(result).toContain('Packed');

    const skillFile = join(outputDir, 'nested-symlink-skill.skill');
    expect(existsSync(skillFile)).toBe(true);

    const listing = execSync(`unzip -l ${skillFile}`, { encoding: 'utf-8' });
    expect(listing).toContain('entry/link-to-dir2/link-to-dir3/deepest.txt');

    const extractedDir = join(testDir, 'extracted-nested');
    execSync(`unzip -o ${skillFile} -d ${extractedDir}`, { encoding: 'utf-8' });

    const deepest = await readFile(
      join(
        extractedDir,
        'nested-symlink-skill',
        'entry',
        'link-to-dir2',
        'link-to-dir3',
        'deepest.txt'
      ),
      'utf-8'
    );
    expect(deepest).toBe('Content in dir3');
  });

  it('handles SKILL.md being a symlink', async () => {
    const skillDir = join(testDir, 'symlink-md-skill');
    await mkdir(skillDir, { recursive: true });

    const targetMd = join(testDir, 'SKILL.md.target');
    await writeFile(
      targetMd,
      `---
name: symlink-md-skill
description: Skill with symlinked SKILL.md
---

# Symlinked Skill MD

This skill has its SKILL.md as a symlink.
`,
      'utf-8'
    );

    const linkMd = join(skillDir, 'SKILL.md');
    await symlink(targetMd, linkMd);

    await writeFile(join(skillDir, 'other.txt'), 'Other content', 'utf-8');

    const result = execSync(
      `node ${join(process.cwd(), 'src', 'cli.ts')} pack ${testDir} --skill symlink-md-skill -y -o ${outputDir} 2>&1`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    expect(result).toContain('Packed');

    const skillFile = join(outputDir, 'symlink-md-skill.skill');
    expect(existsSync(skillFile)).toBe(true);

    const listing = execSync(`unzip -l ${skillFile}`, { encoding: 'utf-8' });
    expect(listing).toContain('SKILL.md');
    expect(listing).toContain('other.txt');

    const extractedDir = join(testDir, 'extracted-md');
    execSync(`unzip -o ${skillFile} -d ${extractedDir}`, { encoding: 'utf-8' });

    const skillMdContent = await readFile(
      join(extractedDir, 'symlink-md-skill', 'SKILL.md'),
      'utf-8'
    );
    expect(skillMdContent).toContain('name: symlink-md-skill');
  });

  it('calculates size with dereferenced symlinks', async () => {
    const skillDir = await makeSkillDir(testDir, 'size-symlink-skill');
    const targetDir = join(testDir, 'size-target');
    await mkdir(targetDir, { recursive: true });

    const targetFile = join(targetDir, 'large.txt');
    const content = 'x'.repeat(10000);
    await writeFile(targetFile, content, 'utf-8');

    const linkPath = join(skillDir, 'large-link.txt');
    await symlink(targetFile, linkPath);

    const result = execSync(
      `node ${join(process.cwd(), 'src', 'cli.ts')} pack ${testDir} --skill size-symlink-skill -y -o ${outputDir} --max-size 20KB`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    expect(result).toContain('Packed');

    const skillFile = join(outputDir, 'size-symlink-skill.skill');
    expect(existsSync(skillFile)).toBe(true);
  });
});
