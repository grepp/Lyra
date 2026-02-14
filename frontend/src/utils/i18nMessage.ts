type Translate = (key: string, options?: Record<string, unknown>) => string;

export function withApiMessage(t: Translate, key: string, message: unknown) {
  const text = typeof message === 'string' && message.trim()
    ? message
    : t('feedback.common.unknownError');
  return t(key, { message: text });
}
