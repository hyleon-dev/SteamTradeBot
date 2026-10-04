const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_ENV = path.join(os.tmpdir(), `stb-env-${process.pid}.env`);
fs.writeFileSync(TMP_ENV, [
    '# comment line',
    'STEAM_USERNAME=bob',
    'DO_NOT_GET_HARD=1,2',
    'PORT=3000',
].join('\n'));
process.env.CONFIG_ENV_PATH = TMP_ENV;

const config = require('./config');

afterAll(() => {
    try { fs.unlinkSync(TMP_ENV); } catch { /* ignore */ }
});

describe('config load', () => {
    test('parses ids and strings, defaults apply', () => {
        expect(config.steam_username).toBe('bob');
        expect(config.do_not_get_hard).toEqual(['1', '2']);
        expect(config.web_host).toBe('127.0.0.1');   // Default
        expect(config.web_ui_enabled).toBe(true);    // bool default
    });
});

describe('config.update', () => {
    test('hot-reload field applies instantly, no restartRequired', () => {
        const { restartRequired } = config.update({ do_not_get_hard: ['9', '8'] });
        expect(restartRequired).toEqual([]);
        expect(config.do_not_get_hard).toEqual(['9', '8']);
        expect(fs.readFileSync(TMP_ENV, 'utf8')).toMatch(/DO_NOT_GET_HARD=9,8/);
    });

    test('secret/infra field reports restartRequired and is kept', () => {
        const { restartRequired } = config.update({ steam_password: 'p@ss word' });
        expect(restartRequired).toContain('steam_password');
        expect(config.steam_password).toBe('p@ss word');
        // Value with special chars or spaces gets quoted
        expect(fs.readFileSync(TMP_ENV, 'utf8')).toMatch(/STEAM_PASSWORD='p@ss word'/);
    });

    test('comments and other lines are kept', () => {
        expect(fs.readFileSync(TMP_ENV, 'utf8')).toMatch(/# comment line/);
    });
});

describe('config.reload', () => {
    test('applies external changes to .env', () => {
        const content = fs.readFileSync(TMP_ENV, 'utf8').replace(/DO_NOT_GET_HARD=[^\n]*/, 'DO_NOT_GET_HARD=42');
        fs.writeFileSync(TMP_ENV, content);
        config.reload();
        expect(config.do_not_get_hard).toEqual(['42']);
    });
});

describe('config.describe', () => {
    test('marks restartRequired and secret correctly', () => {
        const byKey = Object.fromEntries(config.describe().map(f => [f.key, f]));
        expect(byKey.do_not_get_hard.restartRequired).toBe(false);
        expect(byKey.steam_password.restartRequired).toBe(true);
        expect(byKey.steam_password.secret).toBe(true);
    });
});
