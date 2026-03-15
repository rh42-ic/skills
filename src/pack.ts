import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { resolve, relative, basename, dirname } from 'path';
import { homedir } from 'os';
import { readdir as readdirAsync, stat as statAsync } from 'fs/promises';
import archiver from 'archiver';
import { parseSource } from './source-parser.ts';
import { cloneRepo, cleanupTempDir, GitCloneError } from './git.ts';
import { discoverSkills, getSkillDisplayName, filterSkills } from './skills.ts';
import { validateSkill } from './validation.ts';
import type { Skill } from './types.ts';

interface InstalledSkillForPack {
  name: string;
  path: string;
}

const EXCLUDE_DIRS = ['__pycache__', 'node_modules'];
const EXCLUDE_FILES = ['.DS_Store'];
const EXCLUDE_GLOBS = ['*.pyc'];
const ROOT_EXCLUDE_DIRS = ['evals'];

export interface PackOptions {
  output?: string;
  skill?: string[];
  yes?: boolean;
  all?: boolean;
  list?: boolean;
  installed?: boolean;
}

function shouldExclude(relPath: string, skillRootDir: string): boolean {
  const parts = relPath.split(/[/\\]/);

  for (const part of parts) {
    if (EXCLUDE_DIRS.includes(part)) {
      return true;
    }
  }

  if (parts.length > 1) {
    const firstSubdir = parts[1];
    if (firstSubdir && ROOT_EXCLUDE_DIRS.includes(firstSubdir)) {
      return true;
    }
  }

  const filename = parts[parts.length - 1]!;
  if (EXCLUDE_FILES.includes(filename)) {
    return true;
  }

  for (const glob of EXCLUDE_GLOBS) {
    if (matchGlob(filename, glob)) {
      return true;
    }
  }

  return false;
}

function matchGlob(filename: string, pattern: string): boolean {
  if (pattern.startsWith('*') && pattern.endsWith('*')) {
    const substr = pattern.slice(1, -1);
    return filename.includes(substr);
  }
  if (pattern.startsWith('*')) {
    return filename.endsWith(pattern.slice(1));
  }
  if (pattern.endsWith('*')) {
    return filename.startsWith(pattern.slice(0, -1));
  }
  return filename === pattern;
}

async function getInstalledSkillsForPack(): Promise<InstalledSkillForPack[]> {
  const home = homedir();
  const globalSkillsDir = resolve(home, '.agents', 'skills');

  if (!existsSync(globalSkillsDir)) {
    return [];
  }

  const skills: InstalledSkillForPack[] = [];

  try {
    const entries = await readdirAsync(globalSkillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = resolve(globalSkillsDir, entry.name);
      const skillMdPath = resolve(skillDir, 'SKILL.md');

      try {
        await statAsync(skillMdPath);
      } catch {
        continue;
      }

      skills.push({
        name: entry.name,
        path: skillDir,
      });
    }
  } catch {
    // ignore
  }

  return skills;
}

async function packageSkillToZip(
  skillPath: string,
  outputFile: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolvePromise) => {
    const output = createWriteStream(outputFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolvePromise({ success: true });
    });

    output.on('error', (err) => {
      resolvePromise({ success: false, error: err.message });
    });

    archive.on('error', (err) => {
      resolvePromise({ success: false, error: err.message });
    });

    archive.pipe(output);

    const skillRoot = skillPath;
    const parentDir = resolve(skillPath, '..');

    const addDirectory = async (dir: string): Promise<void> => {
      const entries = await readdirAsync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        const relPath = relative(parentDir, fullPath);

        if (shouldExclude(relPath, skillRoot)) {
          continue;
        }

        if (entry.isDirectory()) {
          await addDirectory(fullPath);
        } else if (entry.isFile()) {
          archive.file(fullPath, { name: relPath });
        }
      }
    };

    addDirectory(skillPath)
      .then(() => {
        archive.finalize();
      })
      .catch((err) => {
        resolvePromise({ success: false, error: err.message });
      });
  });
}

export function parsePackOptions(args: string[]): { source: string | null; options: PackOptions } {
  const options: PackOptions = {};
  const positionalArgs: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '-o' || arg === '--output') {
      options.output = args[i + 1];
      i += 2;
      continue;
    }

    if (arg === '-s' || arg === '--skill') {
      options.skill = options.skill || [];
      const value = args[i + 1];
      if (value && !value.startsWith('-')) {
        options.skill.push(value);
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (arg === '-y' || arg === '--yes') {
      options.yes = true;
      i += 1;
      continue;
    }

    if (arg === '--all') {
      options.all = true;
      i += 1;
      continue;
    }

    if (arg === '-l' || arg === '--list') {
      options.list = true;
      i += 1;
      continue;
    }

    if (arg === '--installed') {
      options.installed = true;
      i += 1;
      continue;
    }

    if (arg && arg.startsWith('-')) {
      i += 1;
      continue;
    }

    if (arg) {
      positionalArgs.push(arg);
    }
    i += 1;
  }

  if (options.all) {
    options.skill = ['*'];
    options.yes = true;
  }

  const source = positionalArgs[0] || null;

  return { source, options };
}

async function cleanup(tempDir: string | null): Promise<void> {
  if (tempDir) {
    try {
      await cleanupTempDir(tempDir);
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function runPack(source: string | null, options: PackOptions): Promise<void> {
  const spinner = p.spinner();

  console.log();
  p.intro(pc.bgCyan(pc.black(' skills ')));

  if (options.installed) {
    return runPackInstalled(options, spinner);
  }

  if (!source) {
    console.log();
    console.log(
      pc.bgRed(pc.white(pc.bold(' ERROR '))) + ' ' + pc.red('Missing required argument: source')
    );
    console.log();
    console.log(pc.dim('  Usage:'));
    console.log(
      `    ${pc.cyan('npx skills pack')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`
    );
    console.log();
    console.log(pc.dim('  Example:'));
    console.log(`    ${pc.cyan('npx skills pack')} ${pc.yellow('./my-skill')}`);
    console.log(`    ${pc.cyan('npx skills pack')} ${pc.yellow('owner/repo')}`);
    console.log(
      `    ${pc.cyan('npx skills pack')} ${pc.yellow('--installed')} ${pc.dim('# pack installed skills')}`
    );
    console.log();
    process.exit(1);
  }

  let tempDir: string | null = null;

  try {
    spinner.start('Parsing source...');
    const parsed = parseSource(source);

    if (parsed.type === 'well-known') {
      spinner.stop(pc.red('Unsupported source type'));
      p.outro(
        pc.red('Well-known URLs are not supported for packing. Use a local path or Git repository.')
      );
      process.exit(1);
      return;
    }

    spinner.stop(
      `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}${parsed.skillFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.skillFilter)}` : ''}`
    );

    let skillsDir: string;

    if (parsed.type === 'local') {
      spinner.start('Validating local path...');
      if (!existsSync(parsed.localPath!)) {
        spinner.stop(pc.red('Path not found'));
        p.outro(pc.red(`Local path does not exist: ${parsed.localPath}`));
        process.exit(1);
      }
      skillsDir = parsed.localPath!;
      spinner.stop('Local path validated');
    } else {
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      skillsDir = tempDir;
      spinner.stop('Repository cloned');
    }

    if (parsed.skillFilter) {
      options.skill = options.skill || [];
      if (!options.skill.includes(parsed.skillFilter)) {
        options.skill.push(parsed.skillFilter);
      }
    }

    const includeInternal = !!(options.skill && options.skill.length > 0);

    spinner.start('Discovering skills...');
    const skills = await discoverSkills(skillsDir, parsed.subpath, { includeInternal });

    if (skills.length === 0) {
      spinner.stop(pc.red('No skills found'));
      p.outro(
        pc.red('No valid skills found. Skills require a SKILL.md with name and description.')
      );
      await cleanup(tempDir);
      process.exit(1);
    }

    spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

    if (options.list) {
      console.log();
      p.log.step(pc.bold('Available Skills'));

      const groupedSkills: Record<string, Skill[]> = {};
      const ungroupedSkills: Skill[] = [];

      for (const skill of skills) {
        if (skill.pluginName) {
          const group = skill.pluginName;
          if (!groupedSkills[group]) groupedSkills[group] = [];
          groupedSkills[group]!.push(skill);
        } else {
          ungroupedSkills.push(skill);
        }
      }

      const sortedGroups = Object.keys(groupedSkills).sort();
      for (const group of sortedGroups) {
        const title = group
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        console.log(pc.bold(title));
        for (const skill of groupedSkills[group]!) {
          p.log.message(`  ${pc.cyan(getSkillDisplayName(skill))}`);
          p.log.message(`    ${pc.dim(skill.description)}`);
        }
        console.log();
      }

      if (ungroupedSkills.length > 0) {
        if (sortedGroups.length > 0) console.log(pc.bold('General'));
        for (const skill of ungroupedSkills) {
          p.log.message(`  ${pc.cyan(getSkillDisplayName(skill))}`);
          p.log.message(`    ${pc.dim(skill.description)}`);
        }
      }

      console.log();
      p.outro('Use --skill <name> to pack specific skills');
      await cleanup(tempDir);
      process.exit(0);
    }

    let selectedSkills: Skill[];

    if (options.skill?.includes('*')) {
      selectedSkills = skills;
      p.log.info(`Packing all ${skills.length} skills`);
    } else if (options.skill && options.skill.length > 0) {
      selectedSkills = filterSkills(skills, options.skill);

      if (selectedSkills.length === 0) {
        p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
        p.log.info('Available skills:');
        for (const s of skills) {
          p.log.message(`  - ${getSkillDisplayName(s)}`);
        }
        await cleanup(tempDir);
        process.exit(1);
      }

      p.log.info(
        `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(getSkillDisplayName(s))).join(', ')}`
      );
    } else if (skills.length === 1) {
      selectedSkills = skills;
      const firstSkill = skills[0]!;
      p.log.info(`Skill: ${pc.cyan(getSkillDisplayName(firstSkill))}`);
      p.log.message(pc.dim(firstSkill.description));
    } else if (options.yes) {
      selectedSkills = skills;
      p.log.info(`Packing all ${skills.length} skills`);
    } else {
      const sortedSkills = [...skills].sort((a, b) => {
        if (a.pluginName && !b.pluginName) return -1;
        if (!a.pluginName && b.pluginName) return 1;
        if (a.pluginName && b.pluginName && a.pluginName !== b.pluginName) {
          return a.pluginName.localeCompare(b.pluginName);
        }
        return getSkillDisplayName(a).localeCompare(getSkillDisplayName(b));
      });

      const hasGroups = sortedSkills.some((s) => s.pluginName);

      let selected: Skill[] | symbol;

      if (hasGroups) {
        const kebabToTitle = (s: string) =>
          s
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

        const grouped: Record<string, p.Option<Skill>[]> = {};
        for (const s of sortedSkills) {
          const groupName = s.pluginName ? kebabToTitle(s.pluginName) : 'Other';
          if (!grouped[groupName]) grouped[groupName] = [];
          grouped[groupName]!.push({
            value: s,
            label: getSkillDisplayName(s),
            hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
          });
        }

        selected = await p.groupMultiselect({
          message: `Select skills to pack ${pc.dim('(space to toggle)')}`,
          options: grouped,
          required: true,
        });
      } else {
        const skillChoices = sortedSkills.map((s) => ({
          value: s,
          label: getSkillDisplayName(s),
          hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
        }));

        selected = await p.multiselect({
          message: 'Select skills to pack',
          options: skillChoices,
          required: true,
        });
      }

      if (p.isCancel(selected)) {
        p.cancel('Packing cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      selectedSkills = selected as Skill[];
    }

    const outputDir = options.output ? resolve(options.output) : process.cwd();

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    console.log();
    p.log.info(`Output directory: ${pc.dim(outputDir)}`);
    console.log();

    if (!options.yes) {
      const confirmed = await p.confirm({ message: 'Proceed with packing?' });

      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Packing cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }
    }

    spinner.start('Validating and packing...');

    const results: Array<{
      skill: Skill;
      outputFile: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const skill of selectedSkills) {
      const skillName = getSkillDisplayName(skill);
      const outputFile = resolve(outputDir, `${skillName}.skill`);

      const validation = await validateSkill(skill.path);
      if (!validation.valid) {
        results.push({
          skill,
          outputFile,
          success: false,
          error: validation.message,
        });
        continue;
      }

      const result = await packageSkillToZip(skill.path, outputFile);
      results.push({
        skill,
        outputFile,
        success: result.success,
        error: result.error,
      });
    }

    spinner.stop('Packing complete');

    console.log();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (successful.length > 0) {
      const resultLines: string[] = [];
      for (const r of successful) {
        const relOutput = relative(process.cwd(), r.outputFile);
        resultLines.push(
          `${pc.green('✓')} ${getSkillDisplayName(r.skill)} ${pc.dim('→')} ${relOutput}`
        );
      }
      const title = pc.green(
        `Packed ${successful.length} skill${successful.length !== 1 ? 's' : ''}`
      );
      p.note(resultLines.join('\n'), title);
    }

    if (failed.length > 0) {
      console.log();
      p.log.error(pc.red(`Failed to pack ${failed.length} skill${failed.length !== 1 ? 's' : ''}`));
      for (const r of failed) {
        p.log.message(`  ${pc.red('✗')} ${getSkillDisplayName(r.skill)}: ${pc.dim(r.error)}`);
      }
    }

    console.log();
    p.outro('Done!');

    await cleanup(tempDir);
  } catch (err) {
    spinner.stop(pc.red('Error'));
    if (err instanceof GitCloneError) {
      p.outro(pc.red(`Failed to clone repository: ${err.message}`));
    } else if (err instanceof Error) {
      p.outro(pc.red(err.message));
    } else {
      p.outro(pc.red('An unexpected error occurred'));
    }
    await cleanup(tempDir);
    process.exit(1);
  }
}

async function runPackInstalled(
  options: PackOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  spinner.start('Loading installed skills...');
  const installedSkills = await getInstalledSkillsForPack();
  spinner.stop(
    `Found ${installedSkills.length} installed skill${installedSkills.length !== 1 ? 's' : ''}`
  );

  if (installedSkills.length === 0) {
    p.outro(
      pc.yellow('No installed skills found. Install skills first with `npx skills add <source>`')
    );
    process.exit(0);
  }

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Installed Skills'));
    for (const skill of installedSkills) {
      p.log.message(`  ${pc.cyan(skill.name)}`);
    }
    console.log();
    p.outro('Use --skill <name> to pack specific skills');
    process.exit(0);
  }

  let selectedSkills: InstalledSkillForPack[];

  if (options.skill?.includes('*')) {
    selectedSkills = installedSkills;
    p.log.info(`Packing all ${installedSkills.length} skills`);
  } else if (options.skill && options.skill.length > 0) {
    const skillNames = options.skill.map((s) => s.toLowerCase());
    selectedSkills = installedSkills.filter((s) => skillNames.includes(s.name.toLowerCase()));

    if (selectedSkills.length === 0) {
      p.log.error(`No matching installed skills found for: ${options.skill.join(', ')}`);
      p.log.info('Installed skills:');
      for (const s of installedSkills) {
        p.log.message(`  - ${s.name}`);
      }
      process.exit(1);
    }

    p.log.info(
      `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(s.name)).join(', ')}`
    );
  } else if (installedSkills.length === 1) {
    selectedSkills = installedSkills;
    p.log.info(`Skill: ${pc.cyan(installedSkills[0]!.name)}`);
  } else if (options.yes) {
    selectedSkills = installedSkills;
    p.log.info(`Packing all ${installedSkills.length} skills`);
  } else {
    const skillChoices = installedSkills.map((s) => ({
      value: s,
      label: s.name,
    }));

    const selected = await p.multiselect({
      message: 'Select skills to pack',
      options: skillChoices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Packing cancelled');
      process.exit(0);
    }

    selectedSkills = selected as InstalledSkillForPack[];
  }

  const outputDir = options.output ? resolve(options.output) : process.cwd();

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log();
  p.log.info(`Output directory: ${pc.dim(outputDir)}`);
  console.log();

  if (!options.yes) {
    const confirmed = await p.confirm({ message: 'Proceed with packing?' });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Packing cancelled');
      process.exit(0);
    }
  }

  spinner.start('Validating and packing...');

  const results: Array<{
    skill: InstalledSkillForPack;
    outputFile: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const skill of selectedSkills) {
    const outputFile = resolve(outputDir, `${skill.name}.skill`);

    const validation = await validateSkill(skill.path);
    if (!validation.valid) {
      results.push({
        skill,
        outputFile,
        success: false,
        error: validation.message,
      });
      continue;
    }

    const result = await packageSkillToZip(skill.path, outputFile);
    results.push({
      skill,
      outputFile,
      success: result.success,
      error: result.error,
    });
  }

  spinner.stop('Packing complete');

  console.log();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    const resultLines: string[] = [];
    for (const r of successful) {
      const relOutput = relative(process.cwd(), r.outputFile);
      resultLines.push(`${pc.green('✓')} ${r.skill.name} ${pc.dim('→')} ${relOutput}`);
    }
    const title = pc.green(
      `Packed ${successful.length} skill${successful.length !== 1 ? 's' : ''}`
    );
    p.note(resultLines.join('\n'), title);
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to pack ${failed.length} skill${failed.length !== 1 ? 's' : ''}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill.name}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro('Done!');
}
