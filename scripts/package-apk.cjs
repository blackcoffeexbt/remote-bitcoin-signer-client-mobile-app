/* global __dirname */
// Verify the actual package before publishing any download filename or alias.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const config = require('../app.json').expo;
const sdk = process.env.ANDROID_HOME || path.join(process.env.HOME, 'Library/Android/sdk');
const versions = fs.readdirSync(path.join(sdk, 'build-tools')).filter(v => /^\d+\.\d+\.\d+$/.test(v));
versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
if (!versions.length) throw new Error('Android build tools are required to verify the APK');
const tools = path.join(sdk, 'build-tools', versions[0]);
const source = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const badging = execFileSync(path.join(tools, 'aapt'), ['dump', 'badging', source], { encoding: 'utf8' });
if (!badging.includes(`application-label:'${config.name}'`) ||
    !badging.includes(`package: name='${config.android.package}' versionCode='${config.android.versionCode}' versionName='${config.version}'`)) {
  throw new Error('APK branding or version does not match app.json; refusing to update download links');
}
execFileSync(path.join(tools, 'apksigner'), ['verify', source], { stdio: 'inherit' });
const bytes = fs.readFileSync(source);
const checksum = createHash('sha256').update(bytes).digest('hex');
const directory = path.join(root, 'artifacts');
fs.mkdirSync(directory, { recursive: true });
const filename = `argus-${config.version}-arm64.apk`;
function write(name, content) {
  const destination = path.join(directory, name);
  fs.writeFileSync(destination + '.tmp', content);
  fs.renameSync(destination + '.tmp', destination);
}
// Keep the older client URL current so an existing download page cannot deliver
// an obsolete app. The historical demo APK has a different identity; leave it alone.
for (const name of [filename, 'argus-arm64.apk', 'remote-signer-client-arm64.apk']) {
  write(name, bytes);
  write(name + '.sha256', `${checksum}  ${name}\n`);
}
write('index.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Argus Android download</title><style>body{font:18px system-ui;max-width:600px;margin:8vh auto;padding:24px;background:#F5F8F7;color:#142D36}a{color:#006C67}p{line-height:1.6}.download{display:inline-block;padding:16px 24px;background:#006C67;color:white;border-radius:14px;text-decoration:none;font-weight:700}</style><h1>Argus</h1><p>Remote access. Secret secured.</p><p><strong>Version ${config.version} · Build ${config.android.versionCode}</strong><br>Android 7+ · ARM64 · Testnet4</p><p><a class="download" href="${filename}?sha=${checksum.slice(0,12)}" download>Download Argus ${config.version}</a></p><p>Set the address gap limit in Settings → Advanced settings (20–200, default 20). Transaction history stays saved on this phone. After installation, check Settings for Version ${config.version} · Build ${config.android.versionCode}.</p><p>Install as an update to preserve app data. This locally signed test build runs without a development server.</p><p><a href="${filename}.sha256">SHA-256 checksum</a></p></html>`);
console.log(`Verified ${config.name} ${config.version} (build ${config.android.versionCode})`);
console.log(`APK: ${path.join(directory, filename)}\nSHA-256: ${checksum}`);
