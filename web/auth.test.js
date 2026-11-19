const {createSession, verifySession, readCookie, SESSION_MS, COOKIE_NAME} = require('./auth');

describe('session cookie', () => {
  const now = Date.UTC(2026, 10, 19);

  test('a new session is valid with the same token', () => {
    const {value} = createSession('secret', now);
    expect(verifySession('secret', value, now + 1000)).toBe(true);
  });

  test('another token makes the session invalid', () => {
    const {value} = createSession('secret', now);
    expect(verifySession('other', value, now)).toBe(false);
  });

  test('the session ends after 30 days', () => {
    const {value} = createSession('secret', now);
    expect(verifySession('secret', value, now + SESSION_MS - 1)).toBe(true);
    expect(verifySession('secret', value, now + SESSION_MS)).toBe(false);
  });

  test('a changed expiry time breaks the signature', () => {
    const {value} = createSession('secret', now);
    const [, sig] = value.split('.');
    expect(verifySession('secret', `${now + SESSION_MS * 10}.${sig}`, now)).toBe(false);
  });

  test('broken values are rejected', () => {
    for (const bad of [null, undefined, '', 'abc', '123', '.sig', `${now + 5}.`]) {
      expect(verifySession('secret', bad, now)).toBe(false);
    }
    expect(verifySession('', createSession('', now).value, now)).toBe(false);
  });
});

describe('readCookie', () => {
  test('finds the session cookie among others', () => {
    const req = {headers: {cookie: `a=1; ${COOKIE_NAME}=123.abc%3D; b=2`}};
    expect(readCookie(req)).toBe('123.abc=');
  });

  test('returns null without cookie', () => {
    expect(readCookie({headers: {}})).toBeNull();
  });
});
