import readline from 'node:readline/promises';

export async function chatPrompt() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '› '
  });

  return new Promise((resolve) => {
    const lines = [];
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      resolve(result);
    };

    rl.on('line', (line) => {
      if (line === '' && lines.length === 0) {
        finish(null);
        return;
      }

      if (line === '' && lines.length > 0) {
        finish(lines.join('\n').trim() || null);
        return;
      }

      if (lines.length === 0 && (line.toLowerCase() === 'exit' || line.toLowerCase() === 'quit')) {
        finish(line);
        return;
      }

      lines.push(line);
      rl.setPrompt('  ');
      rl.prompt();
    });

    rl.on('close', () => {
      finish(lines.length > 0 ? lines.join('\n').trim() : null);
    });

    rl.on('SIGINT', () => {
      finish(null);
    });

    rl.prompt();
  });
}

