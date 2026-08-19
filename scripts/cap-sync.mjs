import { spawnSync } from 'child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('npx', ['next', 'build', '--webpack']);
run('npx', ['@capacitor/cli@8.4.2', 'cap', 'sync']);
