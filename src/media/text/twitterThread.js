import { TWITTER_THREAD_API, TWITTER_THREAD_MAX_TWEETS } from '../constants.js';

export async function fetchTwitterThread(tweetUrl, { debug, HumanError }) {
  const apiUrl = new URL(TWITTER_THREAD_API);
  apiUrl.searchParams.set('tweet_url', tweetUrl);
  apiUrl.searchParams.set('max_tweets', String(TWITTER_THREAD_MAX_TWEETS));

  if (debug) debug('Fetching Twitter thread from API:', apiUrl.toString());

  let response;
  try {
    response = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'follow'
    });
  } catch (error) {
    if (debug) debug('Thread API network error:', error?.message || error);
    throw new HumanError('No pude obtener el hilo completo (API).', {
      tip: 'Verifica la conectividad con el endpoint de thread y reintenta.'
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (debug) debug('Thread API HTTP error:', response.status, body.slice(0, 500));
    throw new HumanError(`El API de hilos devolvió ${response.status}`, {
      tip: 'Revisa que la URL de tweet sea pública o vuelve a intentar más tarde.'
    });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new HumanError('Respuesta inválida del API de hilos.', {
      tip: 'El endpoint no devolvió JSON válido.'
    });
  }

  if (!data?.tweets || !Array.isArray(data.tweets) || !data.tweets.length) {
    throw new HumanError('El API no devolvió tweets para este hilo.', {
      tip: data?.message || 'Asegúrate de usar la URL completa del tweet.'
    });
  }

  const author = data.tweets[0]?.author_handle || data.thread_author || 'autor';
  const parts = data.tweets.map((tweet, idx) => {
    const num = idx + 1;
    const total = data.tweets.length;
    const text = tweet?.text || '';
    const likes = tweet?.likes != null ? `❤️ ${tweet.likes} likes` : '';
    return `Tweet ${num}/${total} @${tweet?.author_handle || author} (${tweet?.author_name || ''}):\n${text}\n${likes}`.trim();
  });

  const inlineText = `HILO COMPLETO (${parts.length} tweets)\n\n${parts.join('\n\n---\n\n')}`;
  return { path: `${tweetUrl}#thread`, type: 'text', inlineText };
}

