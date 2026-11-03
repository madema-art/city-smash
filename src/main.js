import { Game } from './core/Game.js';

const params = new URLSearchParams(location.search);

async function boot() {
  if (params.get('view') === 'gorilla') {
    const { runGorillaViewer } = await import('./tools/gorillaViewer.js');
    runGorillaViewer(params);
    return;
  }
  const game = new Game(document.getElementById('app'), params);
  window.__game = game;
  await game.init();
}

boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Error: ' + e.message;
});
