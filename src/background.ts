import type { Extraction } from './clip';
import { clickHandler, type Status } from './flow';
import { post } from './slack';
import { getDestination } from './store';

declare const browser: typeof chrome;
const api = typeof browser !== 'undefined' ? browser : chrome;
const colors = { '…': '#355c78', SET: '#395781', OK: '#17694e', '!': '#923926', '?': '#765018' };
const status: Status = async (tabId, badge, detail) => {
  // A closed tab has no badge. UI failures must never trigger another POST.
  await Promise.allSettled([
    api.action.setBadgeBackgroundColor({ tabId, color: colors[badge] }),
    api.action.setBadgeText({ tabId, text: badge }),
    api.action.setTitle({ tabId, title: `Slack Clipper: ${detail}` }),
  ]);
};

api.action.onClicked.addListener(clickHandler({
  settings: getDestination,
  options: () => api.runtime.openOptionsPage(),
  allowed: () => api.permissions.contains({ origins: ['https://hooks.slack.com/*'] }),
  extract: async tabId => {
    const [frame] = await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['page.js'] });
    return (frame?.result as Extraction | undefined) ?? null;
  },
  pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
  status, post,
}));
