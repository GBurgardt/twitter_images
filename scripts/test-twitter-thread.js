#!/usr/bin/env node
/**
 * Prueba de acceso al scraper de hilos expuesto en superexplainer.app.
 * Ejecuta:
 *   node scripts/test-twitter-thread.js
 */

const THREAD_URL = 'https://x.com/StockSavvyShay/status/1997660953328930894';
const API_ENDPOINT = 'https://superexplainer.app/twitter-api/scrape_thread/';

async function main() {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('tweet_url', THREAD_URL);
  url.searchParams.set('max_tweets', '50');

  console.log('GET', url.toString());

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  console.log('Status:', res.status, res.statusText);
  const text = await res.text();
  console.log('Body (truncated 2k):\n', text.slice(0, 2000));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
