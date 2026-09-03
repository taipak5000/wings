// 🪽 羽トラッカー - Service Worker（PWAオフライン対応）
// ────────────────────────────────────────────────────────────
// このアプリは単一ページ（index.html）で完結しており、同一オリジン上の他アプリ
// （tai-item等）から季節/イベント情報をfetchで取得する仕組みを持つ。そのため
// ここでは「アプリシェル」（index.html本体・manifest.json・アイコン）だけを
// stale-while-revalidateでキャッシュし、それ以外の同一オリジンGET
// （tai-item側の季節情報fetch等）は素通しして常に最新を取得させる
// （キャッシュしてしまうと季節/イベント終了カウントダウンが更新されなくなるため）。
//
// キャッシュを作り直したい場合はCACHE_VERSIONの文字列を上げるだけでよい。
// 古いバージョンのキャッシュはactivate時に自動で破棄される。
const CACHE_VERSION = 'v2'; // v2: cache-first-then-networkからstale-while-revalidateへ変更
const CACHE_NAME = `wings-shell-${CACHE_VERSION}`;

// self.registration.scope（このSWが登録されているディレクトリ）からの相対パスで解決する。
// GitHub Pages上でもローカル検証用サーバー上でも、どのパス配下に置かれても動くようにするため。
const SHELL_PATHS = ['./', './index.html', './manifest.json', './icons/app-icon-192.png', './icons/app-icon-512.png'];
const SHELL_URLS = SHELL_PATHS.map((p) => new URL(p, self.registration.scope).href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 1つでも取得に失敗すると他のURLも含めてinstall自体が失敗してしまうため、
    // 個別にcatchして「取得できたものだけキャッシュする」形にする
    // （例えばアイコンが未配置でもindex.html自体のオフライン起動は妨げない）。
    await Promise.all(SHELL_URLS.map((url) => cache.add(url).catch((err) => {
      console.error('service worker: failed to precache', url, err);
    })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith('wings-shell-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Googleフォント等の他オリジンは対象外
  if (!SHELL_URLS.includes(url.href)) return; // アプリシェル以外（他アプリの季節情報fetch等）は素通し

  // 🩹 stale-while-revalidate: 表示速度優先でキャッシュを即返しつつ、裏側で
  // ネットワークから最新を取得してキャッシュを更新する。以前はcache-first-then-
  // network（キャッシュがあれば以後ずっとそれを使い続ける）だったため、アプリを
  // 更新してもCACHE_VERSIONを上げ忘れると端末側で古いまま固まってしまっていた
  // （tai-itemで実際にユーザー報告のあった不具合と同じ原因）。
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const revalidate = (async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        return cached;
      }
    })();
    if (cached) {
      event.waitUntil(revalidate);
      return cached;
    }
    return revalidate;
  })());
});
