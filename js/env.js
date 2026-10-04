/*
 * Environment detection. The live site is https://draftthestars.com/ (formerly
 * https://zacherytaylor.github.io/dwts-draft/, which GitHub redirects to the domain).
 * All asset and data paths are relative, so the site works at the domain root or a subpath.
 * Anything served from the dwts-draft-staging repo (or localhost) is STAGING:
 *  - shows the "Staging preview" badge
 *  - uses its own localStorage key so it can never touch the live site's saved draft
 *    (both sites share the zacherytaylor.github.io origin, so this matters)
 *  - data is always fetched relative to this page (./data/...), i.e. from the staging
 *    repo's own copy; a guard refuses any data URL that points at the live path.
 */
(function () {
  const path = location.pathname;
  const host = location.hostname;
  const isStaging = /\/dwts-draft-staging(\/|$)/.test(path) || host === 'localhost' || host === '127.0.0.1' || /[?&]env=staging\b/.test(location.search);
  const dataBase = new URL('data/', document.baseURI);
  if (isStaging && /\/dwts-draft\/data\//.test(dataBase.pathname)) {
    throw new Error('Staging guard: refusing to read live data path ' + dataBase.href);
  }
  window.DTS_ENV = {
    name: isStaging ? 'staging' : 'live',
    isStaging,
    storageKey: isStaging ? 'dwts-draft-v3::staging' : 'dwts-draft-v3',
    dataUrl: (file) => new URL(file, dataBase).href
  };
})();
