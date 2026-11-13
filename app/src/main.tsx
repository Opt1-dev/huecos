import { render } from 'preact';
import './styles.css';
import { locale } from './i18n';
import { startSessionTracking } from './lib/session';
import { App } from './ui/App';

document.documentElement.lang = locale.value;
startSessionTracking();
render(<App />, document.getElementById('app')!);
