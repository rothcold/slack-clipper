export type Destination = { webhook: string; label: string };

// Check the literal input, not just a normalized URL. No alternate authorities,
// ports, empty query/fragment delimiters, escapes or dot-segment resolution.
export function validWebhook(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 &&
    /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/u.test(value);
}

export function validLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 &&
    value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value) && !value.includes('://');
}

export function isDestination(value: unknown): value is Destination {
  return !!value && typeof value === 'object' && 'webhook' in value && 'label' in value &&
    validWebhook(value.webhook) && validLabel(value.label);
}
