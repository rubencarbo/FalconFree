// Genera un único HTML autocontenido (JS + CSS en línea) para probar el juego
// como artefacto o abriéndolo directamente, sin servidor.
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = 'dist-artifact/build';
await build({
  logLevel: 'warn',
  base: './',
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});

const assets = join(outDir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const html = readFileSync(join(outDir, 'index.html'), 'utf8');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();

const page = `<title>FalconFree</title>
<meta name="description" content="Simulador de vuelo arcade sobre ciudades vóxel infinitas.">
<style>
:root { color-scheme: dark; }
${css}
</style>
${body}
<script type="module">
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;
mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/falconfree.html', page);
console.log(`dist-artifact/falconfree.html  ${(page.length / 1024).toFixed(0)} KB`);
