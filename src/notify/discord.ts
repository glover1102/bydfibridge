export interface Notifier {
  notify(title: string, details: Record<string, unknown>): Promise<void>;
}

export class DiscordNotifier implements Notifier {
  constructor(private readonly webhookUrl?: string) {}

  async notify(title: string, details: Record<string, unknown>): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: `**${title}**\n\n\
\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``
      })
    });
  }
}
