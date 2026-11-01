import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const script = fileURLToPath(new URL('./setup_local.py', import.meta.url));
const child = spawn(python, [script, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('error', () => {
  console.error('Python 3.10–3.13 is required. Install Python, or set PYTHON to its executable path.');
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
