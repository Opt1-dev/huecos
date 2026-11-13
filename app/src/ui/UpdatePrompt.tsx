import { useRegisterSW } from 'virtual:pwa-register/preact';
import { t } from '../i18n';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div class="toast" role="status">
      <span>{t.value('update.available')}</span>
      <button type="button" class="btn primary" onClick={() => void updateServiceWorker(true)}>
        {t.value('update.reload')}
      </button>
    </div>
  );
}
