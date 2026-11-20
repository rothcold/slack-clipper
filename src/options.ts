import { validLabel, validWebhook } from './config';
import { getDestination, saveDestination } from './store';

function element<T extends HTMLElement>(selector: string) {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error('Incomplete settings page');
  return el;
}
const form = element<HTMLFormElement>('#form');
const fields = element<HTMLFieldSetElement>('#fields');
const label = element<HTMLInputElement>('#label');
const hook = element<HTMLInputElement>('#hook');
const state = element<HTMLSpanElement>('#state');
const feedback = element<HTMLParagraphElement>('#feedback');
const forget = element<HTMLButtonElement>('#forget');

function show(saved?: string) {
  state.textContent = saved ? `Saved · ${saved}` : 'Not configured';
  label.value = saved ?? '';
  hook.value = '';
  hook.placeholder = saved ? 'Paste a webhook to replace this destination' : 'Paste your Slack webhook URL';
  forget.hidden = !saved;
}
function note(text: string, error = false) {
  feedback.textContent = text;
  feedback.classList.toggle('error', error);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const name = label.value.trim();
  if (!validLabel(name)) { note('Enter a short channel label, not a URL.', true); label.focus(); return; }
  if (!validWebhook(hook.value)) { note('Use a full https://hooks.slack.com/services/ webhook with no extra characters.', true); hook.focus(); return; }
  fields.disabled = true;
  try {
    await saveDestination({ label: name, webhook: hook.value });
    show(name); note('Saved locally. Return to the page and click Slack Clipper to send.');
  } catch { note('Could not save this destination. Check browser storage settings.', true); }
  finally { fields.disabled = false; }
});
forget.addEventListener('click', async () => {
  fields.disabled = true;
  try {
    await saveDestination(null); show(); note('Forgot this destination locally. This does not revoke the webhook in Slack.');
  } catch { note('Could not remove this destination.', true); }
  finally { fields.disabled = false; }
});
getDestination().then(dest => { show(dest?.label); fields.disabled = false; }).catch(() => {
  state.textContent = 'Storage unavailable'; note('Cannot open local settings. Check browser storage settings.', true);
});
