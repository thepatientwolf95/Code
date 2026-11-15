// Notifications : console toujours, + Telegram et/ou ntfy si configurés.
export class Notifier {
  constructor(cfg) {
    this.cfg = cfg;
  }

  async send(title, body = '', url = '') {
    console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${title}${body ? ' — ' + body.replace(/\n/g, ' | ') : ''}`);
    const { telegramToken, telegramChatId, ntfyTopic } = this.cfg;
    const jobs = [];
    if (telegramToken && telegramChatId) {
      jobs.push(
        fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: [title, body, url].filter(Boolean).join('\n'),
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(8000),
        }),
      );
    }
    if (ntfyTopic) {
      jobs.push(
        fetch('https://ntfy.sh', {
          method: 'POST',
          body: JSON.stringify({ topic: ntfyTopic, title, message: body || title, click: url || undefined }),
          signal: AbortSignal.timeout(8000),
        }),
      );
    }
    for (const r of await Promise.allSettled(jobs)) {
      if (r.status === 'rejected') console.error('Notification échouée:', r.reason?.message);
      else if (!r.value.ok) console.error('Notification refusée: HTTP', r.value.status);
    }
  }
}
