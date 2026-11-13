import { session } from '../lib/session';
import { Login } from './Login';
import { Shell } from './Shell';
import { UpdatePrompt } from './UpdatePrompt';

export function App() {
  if (session.value === undefined) return <div class="splash" aria-busy="true" />;
  return (
    <>
      {session.value ? <Shell /> : <Login />}
      <UpdatePrompt />
    </>
  );
}
