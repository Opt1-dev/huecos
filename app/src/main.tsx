import { render } from 'preact';
import './styles.css';
import './day.css';
import { locale } from './i18n';
import { startSessionTracking } from './lib/session';
import { demoMode } from './lib/data';
import { App } from './ui/App';

document.documentElement.lang = locale.value;

async function start() {
  // Dev server only: ?demo shows sample data without signing in.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
    demoMode.value = true;
    (await import('./lib/demo')).loadDemo();
  } else {
    startSessionTracking();
  }
  render(<App />, document.getElementById('app')!);
}
void start();
