import * as clack from '@clack/prompts';

export async function confirm(message, defaultValue = true) {
  const result = await clack.confirm({
    message,
    initialValue: defaultValue
  });

  if (clack.isCancel(result)) return false;
  return result;
}

export function showWelcome() {
  console.log('');
  clack.intro('twx');
}

export function showGoodbye(message = 'Hasta luego') {
  clack.outro(message);
}

export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

