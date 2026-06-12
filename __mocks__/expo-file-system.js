// Stub for expo-file-system (new API) — the native file-system module is
// unavailable in Jest's node testEnvironment.

const Paths = {
  cache: { uri: 'file:///cache/' },
  document: { uri: 'file:///document/' },
  bundle: { uri: 'file:///bundle/' },
};

class File {
  constructor(...uris) {
    this.uri = uris.map((u) => (typeof u === 'string' ? u : u.uri ?? '')).join('');
  }
  write = jest.fn();
  text = jest.fn(() => Promise.resolve(''));
  textSync = jest.fn(() => '');
  create = jest.fn();
  delete = jest.fn();
  get exists() { return false; }
}

class Directory {
  constructor(...uris) {
    this.uri = uris.map((u) => (typeof u === 'string' ? u : u.uri ?? '')).join('');
  }
  create = jest.fn();
  get exists() { return false; }
}

module.exports = {
  Paths,
  File,
  Directory,
};
