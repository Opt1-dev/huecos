// French is the reference dictionary: es.ts and en.ts must provide every key.
export const fr = {
  'app.name': 'Huecos',
  'app.tagline': 'Ton vrai temps libre, tes tâches, tes rendus et tes notes.',
  'tabs.label': 'Sections',
  'tabs.day': 'Ma journée',
  'tabs.rendus': 'Rendus et notes',
  'tabs.notes': 'Notes',
  'tabs.settings': 'Réglages',
  'login.title': 'Connexion',
  'login.email': 'Adresse e-mail',
  'login.submit': 'Recevoir un lien de connexion',
  'login.sending': 'Envoi…',
  'login.sent': 'Lien envoyé. Ouvre l’e-mail sur cet appareil pour te connecter.',
  'login.inviteOnly': 'Huecos fonctionne sur invitation. Si ton adresse n’est pas invitée, aucun lien ne sera envoyé.',
  'login.error': 'Impossible d’envoyer le lien : {message}',
  'session.signOut': 'Se déconnecter',
  'settings.language': 'Langue',
  'status.offline': 'Hors ligne',
  'status.lastSynced': 'Dernière synchro {time}',
  'placeholder.comingSoon': 'Cette section arrive dans une prochaine phase.',
  'update.available': 'Une nouvelle version est disponible.',
  'update.reload': 'Mettre à jour',
} as const;

export type MessageKey = keyof typeof fr;
export type Dictionary = Record<MessageKey, string>;
