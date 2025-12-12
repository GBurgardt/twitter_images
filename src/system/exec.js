import { spawn } from 'node:child_process';
import process from 'node:process';

export async function runExternalCommand(command, args, options = {}) {
  const { env = null, debug = null } = options;
  if (debug) debug('Executing:', command, args);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env
    });

    let stderr = '';
    let stdout = '';

    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));

    child.on('error', (error) => {
      if (error?.code === 'ENOENT') {
        reject(new Error(`${command} not found. Install it and make sure it's in your PATH.`));
        return;
      }
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        if (debug) debug('Command OK:', command);
        resolve(stdout);
      } else {
        reject(new Error(`${command} failed with code ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`));
      }
    });
  });
}

export async function runCommandCaptureStdout(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed: ${stderr.slice(0, 200)}`));
    });
  });
}

