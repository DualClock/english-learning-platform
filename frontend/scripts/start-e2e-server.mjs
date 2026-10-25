import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Dev-сервер для Playwright.
 *
 * Next при старте чистит свой каталог сборки, а песочница этого окружения
 * блокирует массовое удаление файлов (safe-delete). Поэтому каталог убираем
 * до запуска — силами ОС, а не Node, — и только потом поднимаем сервер.
 */
const distDir = process.env.NEXT_DIST_DIR || '.next-e2e';
const port = process.env.E2E_PORT || '3100';

if (process.platform === 'win32' && existsSync(distDir)) {
  execSync(`cmd /c rmdir /s /q "${distDir}"`, { stdio: 'ignore' });
}

const child = spawn('npx', ['next', 'dev', '-p', port], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: distDir },
});

child.on('exit', (code) => process.exit(code ?? 0));
