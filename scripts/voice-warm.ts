// Pre-generates every line the demo script makes a robot say, so the stage plays from cache.
import { HOME_VOICES, say } from '../server/voice';
import { LINES } from '../web/src/voice';

const lines: [string, string][] = [];
const homes = Object.keys(HOME_VOICES);
for (const h of homes) {
  lines.push([h, "I don't know how to do that yet."]);
  lines.push([h, 'load the dishwasher, version 1, from James.']);
  lines.push([h, 'kitchen tidy, version 1, from James. Knife goes high.']);
  lines.push([h, 'Rolled back to version 1.']);
}
for (const h of ['home-1', 'home-2', 'home-3', 'home-4']) lines.push([h, 'kitchen tidy, version 2, from Alex. Knife goes low.']);
for (const h of ['home-5', 'home-6']) {
  lines.push([h, 'Refused. There are kids in this house.']);
  lines.push([h, "I won't do that here. There are kids in this house."]);
}
const ml: [string, string, string][] = [
  ['home-5', LINES.fr.ran('kitchen tidy', 1, 'James', 'high'), 'fr'],
  ['home-2', LINES.zh.ran('kitchen tidy', 2, 'Alex', 'low'), 'zh'],
  ['home-2', LINES.zh.ran('kitchen tidy', 1, 'James', 'high'), 'zh'],
  ['home-2', LINES.es.ran('load the dishwasher', 1, 'James', ''), 'es'],
];
const prov = (t: string, v: number, parent: [string, number] | null, took: number, refused: number, status = 'trial') =>
  ({ lesson: { title: 'kitchen tidy', version: v, teacherName: t, status }, parents: parent ? [{ title: 'kitchen tidy', version: parent[1], teacherName: parent[0] }] : [], took, refused });
lines.push(['home-2', LINES.en.provenance(prov('Alex', 2, ['James', 1], 4, 2))]);
lines.push(['home-2', LINES.en.provenance(prov('James', 1, null, 6, 0, 'proven'))]);
let chars = 0;
for (const [h, t] of lines) { await say(h, t); chars += t.length; }
for (const [h, t, l] of ml) { await say(h, t, l); chars += t.length; }
lines.push(...ml.map(([h, t]) => [h, t] as [string, string]));
console.log(`voice cache warm: ${lines.length} lines across ${homes.length} voices (${chars} characters if all were new)`);
