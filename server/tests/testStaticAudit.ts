import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface AuditResult {
  name: string;
  passed: boolean;
  details: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

function getAllSourceFiles(dir: string, extList: string[]): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === 'node_modules' || file === 'dist' || file === '.git') continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllSourceFiles(fullPath, extList));
    } else if (extList.some((ext) => file.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

export function runStaticAndUiAudit(): AuditResult[] {
  const results: AuditResult[] = [];

  // 1. TypeScript Compile Check
  try {
    execSync('npx tsc --noEmit', { cwd: ROOT_DIR, stdio: 'pipe' });
    results.push({
      name: 'TypeScript Static Compilation (tsc --noEmit)',
      passed: true,
      details: '0 type errors across src/ and server/',
    });
  } catch (err: any) {
    results.push({
      name: 'TypeScript Static Compilation (tsc --noEmit)',
      passed: false,
      details: err.stderr?.toString() || err.stdout?.toString() || err.message,
    });
  }

  // 2. Production Build Check
  try {
    execSync('npm run build', { cwd: ROOT_DIR, stdio: 'pipe' });
    results.push({
      name: 'Production Packaging Build (vite build)',
      passed: true,
      details: 'Production bundle generated in dist/',
    });
  } catch (err: any) {
    results.push({
      name: 'Production Packaging Build (vite build)',
      passed: false,
      details: err.stderr?.toString() || err.stdout?.toString() || err.message,
    });
  }

  // 3. Line Count Audit (< 300 lines rule)
  const srcFiles = getAllSourceFiles(path.join(ROOT_DIR, 'src'), ['.ts', '.tsx']);
  const serverFiles = getAllSourceFiles(path.join(ROOT_DIR, 'server'), ['.ts']);
  const allFiles = [...srcFiles, ...serverFiles];

  const fileStats = allFiles.map((file) => {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n').length;
    return { file: path.relative(ROOT_DIR, file), lines };
  });

  fileStats.sort((a, b) => b.lines - a.lines);
  const over300 = fileStats.filter((f) => f.lines >= 300);

  const top5 = fileStats.slice(0, 5).map((f) => `${f.file}: ${f.lines}L`).join(', ');

  results.push({
    name: 'GEMINI.md Modularity Audit (< 300 lines/file)',
    passed: over300.length === 0,
    details: over300.length === 0
      ? `100% compliant (${fileStats.length} files). Top: ${top5}`
      : `Violations: ${over300.map((f) => `${f.file} (${f.lines}L)`).join(', ')}`,
  });

  // 4. Forbidden Emojis Check
  const tsxFiles = getAllSourceFiles(path.join(ROOT_DIR, 'src'), ['.tsx']);
  const forbiddenEmojiRegex = /🔒|📎|☑|⚠|🔗|✨|🚀/;
  const emojiViolations: string[] = [];

  for (const f of tsxFiles) {
    const content = fs.readFileSync(f, 'utf8');
    if (forbiddenEmojiRegex.test(content)) {
      emojiViolations.push(path.relative(ROOT_DIR, f));
    }
  }

  results.push({
    name: 'Anti-Slop Audit: Forbidden Emoji Ban in JSX',
    passed: emojiViolations.length === 0,
    details: emojiViolations.length === 0
      ? '0 forbidden emojis found across all TSX files'
      : `Found forbidden emojis in: ${emojiViolations.join(', ')}`,
  });

  // 5. Dark Mode / Neon Slop Classes Check
  const darkClassesRegex = /bg-slate-9|bg-gray-9|bg-zinc-950|bg-indigo-950|drop-shadow-\[0_0/;
  const darkViolations: string[] = [];

  for (const f of tsxFiles) {
    const content = fs.readFileSync(f, 'utf8');
    if (darkClassesRegex.test(content)) {
      darkViolations.push(path.relative(ROOT_DIR, f));
    }
  }

  results.push({
    name: 'Anti-Slop Audit: Dark/Neon Class Purge',
    passed: darkViolations.length === 0,
    details: darkViolations.length === 0
      ? '0 dark-slop/neon classes detected in UI components'
      : `Detected dark classes in: ${darkViolations.join(', ')}`,
  });

  // 6. Canvas Layout Verification
  const canvasToolbarPath = path.join(ROOT_DIR, 'src/components/views/canvas/CanvasToolbar.tsx');
  const canvasToolbarContent = fs.readFileSync(canvasToolbarPath, 'utf8');
  const hasBottom5 = canvasToolbarContent.includes('bottom-5');

  const canvasViewPath = path.join(ROOT_DIR, 'src/components/views/CanvasView.tsx');
  const canvasViewContent = fs.readFileSync(canvasViewPath, 'utf8');
  const hasRedundantStats = canvasViewContent.includes('Số lượng Task:') || canvasViewContent.includes('Tỷ lệ hoàn thành:');

  results.push({
    name: 'Canvas Layout Audit: Bottom Floating Dock & Clean Surface',
    passed: hasBottom5 && !hasRedundantStats,
    details: hasBottom5 && !hasRedundantStats
      ? 'CanvasToolbar anchored at bottom-5; permanent status counter bar eliminated'
      : 'CanvasToolbar not at bottom-5 or redundant stats bar still present',
  });

  return results;
}
