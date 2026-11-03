import { createRoot } from 'react-dom/client';
import { App } from './App';
import { runSmoke } from './smoke';
import { app, boot } from './state/app';
import './styles.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  try {
    await boot();
  } catch (e) {
    document.getElementById('root')!.textContent = `MindHz failed to start: ${String(e)}`;
    throw e;
  }
  root.render(<App />);
  const info = app.get().info;
  if (info?.smokeTest) setTimeout(() => void runSmoke(info.smokePhase), 500);
}

void start();
